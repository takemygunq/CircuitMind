import { getComponent } from '../library';
import type { BoardDef, Language, Project } from '../schema';
import { buildPinBindings, buildPreamble, composeFirmware, type PinBinding } from './pinmap';

/** Детерминированный каркас прошивки по ролям пинов и типам деталей. Работает без ИИ (демо, запасной вариант). */
export function templateFirmware(project: Project, board: BoardDef, language: Language): string {
  const bindings = buildPinBindings(project, board);
  return composeFirmware(
    buildPreamble(bindings, language, board),
    templateBody(project, board, bindings, language),
  );
}

interface Found {
  b: PinBinding;
  kind: string | undefined;
  pin: string; // вывод детали
}

function describe(project: Project, bindings: PinBinding[]): Found[] {
  const kindOf = (ref: string) =>
    getComponent(project.parts.find((p) => p.instanceId === ref)?.componentId ?? '')?.kind;
  return bindings.map((b) => {
    const [ref, pin] = (b.peers[0] ?? ':').split(':');
    return { b, kind: kindOf(ref), pin };
  });
}

export function templateBody(
  project: Project,
  board: BoardDef,
  bindings: PinBinding[],
  language: Language,
): string {
  const f = describe(project, bindings);
  const by = (kind: string, pin?: string) =>
    f.find((x) => x.kind === kind && (!pin || x.pin === pin))?.b.name;
  const leds = f
    .filter(
      (x) =>
        x.kind === 'led' ||
        (x.b.role === 'output' &&
          !['hcsr04', 'servo'].includes(x.kind ?? '') &&
          x.kind !== 'relay_module'),
    )
    .map((x) => x.b.name);
  const buttons = f.filter((x) => x.b.role === 'input_pullup').map((x) => x.b.name);
  const analog = f.filter((x) => x.b.role === 'analog_in').map((x) => x.b.name);
  const dht = by('dht22', 'DATA');
  const sda = f.find((x) => x.b.role === 'i2c_sda')?.b.name;
  const scl = f.find((x) => x.b.role === 'i2c_scl')?.b.name;
  const oled = f.some((x) => x.kind === 'ssd1306');
  const trig = by('hcsr04', 'TRIG');
  const echo = by('hcsr04', 'ECHO');
  const servo = by('servo', 'SIG');
  const relay = by('relay_module', 'IN');
  const flexible = board.flexibleMux;

  if (language === 'arduino') {
    const inc = [
      dht && '#include <DHT.h>',
      oled && '#include <Wire.h>\n#include <Adafruit_GFX.h>\n#include <Adafruit_SSD1306.h>',
      servo && (flexible ? '#include <ESP32Servo.h>' : '#include <Servo.h>'),
    ]
      .filter(Boolean)
      .join('\n');
    const globals = [
      dht && `DHT dht(${dht}, DHT22);`,
      oled && 'Adafruit_SSD1306 display(128, 64, &Wire, -1);',
      servo && 'Servo servo;',
      'unsigned long lastTick = 0;',
      'bool ledState = false;',
    ]
      .filter(Boolean)
      .join('\n');
    const setup = [
      'Serial.begin(115200);',
      ...leds.map((n) => `pinMode(${n}, OUTPUT);`),
      relay && `pinMode(${relay}, OUTPUT);`,
      ...buttons.map((n) => `pinMode(${n}, INPUT_PULLUP);`),
      trig && `pinMode(${trig}, OUTPUT);`,
      echo && `pinMode(${echo}, INPUT);`,
      dht && 'dht.begin();',
      oled && (sda && scl && flexible ? `Wire.begin(${sda}, ${scl});` : 'Wire.begin();'),
      oled && 'display.begin(SSD1306_SWITCHCAPVCC, 0x3C);',
      servo && `servo.attach(${servo});`,
    ].filter(Boolean);
    const loop = [
      `if (millis() - lastTick >= 1000) {`,
      `  lastTick = millis();`,
      leds[0] &&
        `  ledState = !ledState;\n${leds.map((n) => `  digitalWrite(${n}, ledState);`).join('\n')}`,
      dht &&
        `  float t = dht.readTemperature();\n  float h = dht.readHumidity();\n  Serial.printf("T=%.1f C, H=%.1f %%\\n", t, h);`,
      oled &&
        `  display.clearDisplay();\n  display.setTextSize(1);\n  display.setTextColor(SSD1306_WHITE);\n  display.setCursor(0, 0);\n  display.println("CircuitMind");\n  display.display();`,
      trig &&
        echo &&
        `  digitalWrite(${trig}, HIGH);\n  delayMicroseconds(10);\n  digitalWrite(${trig}, LOW);\n  float cm = pulseIn(${echo}, HIGH, 30000) / 58.0;\n  Serial.printf("distance=%.1f cm\\n", cm);`,
      ...analog.map((n) => `  Serial.println(analogRead(${n}));`),
      `}`,
      ...buttons.map(
        (n) =>
          `if (digitalRead(${n}) == LOW) {\n  Serial.println("${n} pressed");\n  delay(50);\n}`,
      ),
      servo && `// servo: servo.write(0..180);`,
    ].filter(Boolean);
    return [
      inc,
      globals,
      `void setup() {\n${indent(setup.join('\n'))}\n}`,
      `void loop() {\n${indent(loop.join('\n'))}\n}`,
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  if (language === 'micropython' || language === 'circuitpython') {
    const cp = language === 'circuitpython';
    const imports = cp
      ? ['import time', 'import board', 'import digitalio', analog.length && 'import analogio']
      : [
          'import time',
          'from machine import Pin',
          analog.length && 'from machine import ADC',
          dht && 'import dht',
          (oled || sda) && 'from machine import I2C',
        ];
    const setup = cp
      ? [
          ...leds.map(
            (n) =>
              `${n.toLowerCase()}_io = digitalio.DigitalInOut(${n})\n${n.toLowerCase()}_io.direction = digitalio.Direction.OUTPUT`,
          ),
          ...buttons.map(
            (n) =>
              `${n.toLowerCase()}_io = digitalio.DigitalInOut(${n})\n${n.toLowerCase()}_io.switch_to_input(pull=digitalio.Pull.UP)`,
          ),
          ...analog.map((n) => `${n.toLowerCase()}_adc = analogio.AnalogIn(${n})`),
        ]
      : [
          ...leds.map((n) => `${n.toLowerCase()}_pin = Pin(${n}, Pin.OUT)`),
          ...buttons.map((n) => `${n.toLowerCase()}_pin = Pin(${n}, Pin.IN, Pin.PULL_UP)`),
          ...analog.map((n) => `${n.toLowerCase()}_adc = ADC(Pin(${n}))`),
          dht && `sensor = dht.DHT22(Pin(${dht}))`,
          sda && scl && `i2c = I2C(0, sda=Pin(${sda}), scl=Pin(${scl}))`,
        ];
    const loopLines = cp
      ? [
          ...leds.map((n) => `${n.toLowerCase()}_io.value = state`),
          ...buttons.map((n) => `if not ${n.toLowerCase()}_io.value:\n    print("${n} pressed")`),
          ...analog.map((n) => `print(${n.toLowerCase()}_adc.value)`),
        ]
      : [
          ...leds.map((n) => `${n.toLowerCase()}_pin.value(state)`),
          ...buttons.map(
            (n) => `if ${n.toLowerCase()}_pin.value() == 0:\n    print("${n} pressed")`,
          ),
          ...analog.map((n) => `print(${n.toLowerCase()}_adc.read_u16())`),
          dht &&
            'sensor.measure()\nprint("T=%.1f C, H=%.1f %%" % (sensor.temperature(), sensor.humidity()))',
        ];
    return [
      imports.filter(Boolean).join('\n'),
      setup.filter(Boolean).join('\n'),
      `state = 0\nwhile True:\n    state = 1 - state\n${indent(loopLines.filter(Boolean).join('\n'), 4)}\n    time.sleep(1)`,
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  if (language === 'esp-idf') {
    const cfg = [...leds, ...(relay ? [relay] : [])].map(
      (n) => `    gpio_set_direction(${n}, GPIO_MODE_OUTPUT);`,
    );
    const btn = buttons.map(
      (n) =>
        `    gpio_set_direction(${n}, GPIO_MODE_INPUT);\n    gpio_set_pull_mode(${n}, GPIO_PULLUP_ONLY);`,
    );
    return [
      '#include "driver/gpio.h"',
      '#include "freertos/FreeRTOS.h"',
      '#include "freertos/task.h"',
      `void app_main(void) {\n${[...cfg, ...btn].join('\n')}\n    int level = 0;\n    while (true) {\n        level = !level;\n${leds.map((n) => `        gpio_set_level(${n}, level);`).join('\n')}\n        vTaskDelay(pdMS_TO_TICKS(1000));\n    }\n}`,
    ].join('\n\n');
  }

  return `import time\n\n# TODO: configure the GPIO pins from the pin block above\nwhile True:\n    time.sleep(1)`;
}

const indent = (s: string, n = 2) =>
  s
    .split('\n')
    .map((l) => (l ? ' '.repeat(n) + l : l))
    .join('\n');
