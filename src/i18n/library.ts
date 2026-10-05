import type { Locale } from './index';

type Tr = Record<Locale, string>;
const tr = (ru: string, en: string, uk: string): Tr => ({ ru, en, uk });

/** Названия деталей библиотеки на трёх языках (в JSON они хранятся по-русски). */
const COMPONENT_NAMES: Record<string, Tr> = {
  'button-6mm': tr('Кнопка тактовая 6×6 мм', 'Tactile button 6×6 mm', 'Кнопка тактова 6×6 мм'),
  'dc-motor-130': tr(
    'Коллекторный мотор 130 (3–6 В)',
    'Brushed DC motor 130 (3–6 V)',
    'Колекторний мотор 130 (3–6 В)',
  ),
  dht22: tr('DHT22 (AM2302)', 'DHT22 (AM2302)', 'DHT22 (AM2302)'),
  'diode-1n4007': tr('Диод 1N4007', 'Diode 1N4007', 'Діод 1N4007'),
  'hc-sr04': tr(
    'Ультразвуковой дальномер HC-SR04',
    'HC-SR04 ultrasonic distance sensor',
    'Ультразвуковий далекомір HC-SR04',
  ),
  'led-5mm-red': tr('Светодиод 5 мм красный', 'LED 5 mm red', 'Світлодіод 5 мм червоний'),
  'level-shifter-4ch': tr(
    'Преобразователь уровней 4 канала (LV↔HV)',
    '4-channel level shifter (LV↔HV)',
    'Перетворювач рівнів 4 канали (LV↔HV)',
  ),
  'mosfet-irlz44n': tr('N-MOSFET IRLZ44N', 'N-MOSFET IRLZ44N', 'N-MOSFET IRLZ44N'),
  'npn-2n2222': tr('NPN транзистор 2N2222', 'NPN transistor 2N2222', 'NPN транзистор 2N2222'),
  'potentiometer-10k': tr('Потенциометр 10 кОм', 'Potentiometer 10 kΩ', 'Потенціометр 10 кОм'),
  'relay-5v-coil': tr(
    'Реле 5 В (катушка, голое)',
    '5 V relay (bare coil)',
    'Реле 5 В (котушка, голе)',
  ),
  'relay-module-1ch': tr(
    'Модуль реле 1 канал (5 В)',
    '1-channel relay module (5 V)',
    'Модуль реле 1 канал (5 В)',
  ),
  resistor: tr('Резистор', 'Resistor', 'Резистор'),
  'servo-sg90': tr('Серво SG90', 'SG90 servo', 'Серво SG90'),
  'ssd1306-128x64-i2c': tr(
    'OLED SSD1306 128×64 (I²C)',
    'OLED SSD1306 128×64 (I²C)',
    'OLED SSD1306 128×64 (I²C)',
  ),
};

/** Название детали на языке интерфейса; если перевода нет (деталь из ИИ), остаётся имя из библиотеки. */
export const componentName = (id: string, fallback: string, locale: Locale): string =>
  COMPONENT_NAMES[id]?.[locale] ?? fallback;

/** Демо-проекты: название, описание и предупреждения на трёх языках. */
const DEMO: Record<string, { title: Tr; description: Tr; warnings?: Tr[] }> = {
  'weather-esp32': {
    title: tr(
      'Мини-метеостанция на ESP32',
      'ESP32 mini weather station',
      'Міні-метеостанція на ESP32',
    ),
    description: tr(
      'ESP32 измеряет температуру и влажность датчиком DHT22, показывает значения на OLED-дисплее SSD1306, мигает светодиодом при выходе за порог, а кнопка переключает экран.',
      'The ESP32 reads temperature and humidity from a DHT22, shows them on an SSD1306 OLED, blinks an LED when a threshold is exceeded, and a button switches the screen.',
      'ESP32 вимірює температуру й вологість датчиком DHT22, показує значення на OLED-дисплеї SSD1306, блимає світлодіодом при виході за поріг, а кнопка перемикає екран.',
    ),
    warnings: [
      tr(
        'Кнопка подключена между GPIO19 и GND: включите внутреннюю подтяжку INPUT_PULLUP.',
        'The button is wired between GPIO19 and GND: enable the internal INPUT_PULLUP.',
        'Кнопку підключено між GPIO19 і GND: увімкніть внутрішню підтяжку INPUT_PULLUP.',
      ),
      tr(
        'DHT22 нельзя опрашивать чаще, чем раз в 2 секунды.',
        'The DHT22 must not be polled more often than once every 2 seconds.',
        'DHT22 не можна опитувати частіше, ніж раз на 2 секунди.',
      ),
    ],
  },
  'blink-uno': {
    title: tr('Мигающий светодиод', 'Blinking LED', 'Блимаючий світлодіод'),
    description: tr(
      'Светодиод мигает с частотой 1 Гц от пина D13 Arduino Uno.',
      'An LED blinks at 1 Hz from pin D13 of an Arduino Uno.',
      'Світлодіод блимає з частотою 1 Гц від піна D13 Arduino Uno.',
    ),
  },
  'broken-esp32': {
    title: tr(
      'Дальномер с ошибками (учебный пример ERC)',
      'Rangefinder with mistakes (ERC training example)',
      'Далекомір з помилками (навчальний приклад ERC)',
    ),
    description: tr(
      'ESP32, дальномер HC-SR04 и светодиод. В схеме нарочно допущено несколько типичных ошибок.',
      'An ESP32, an HC-SR04 rangefinder and an LED. The circuit deliberately contains several typical mistakes.',
      'ESP32, далекомір HC-SR04 і світлодіод. У схемі навмисно допущено кілька типових помилок.',
    ),
  },
  'symbols-uno': {
    title: tr(
      'Мотор, MOSFET и реле (набор символов)',
      'Motor, MOSFET and relay (symbol set)',
      'Мотор, MOSFET і реле (набір символів)',
    ),
    description: tr(
      'Мотор через NPN с защитным диодом, светодиод через MOSFET, реле и потенциометр.',
      'A motor through an NPN with a flyback diode, an LED through a MOSFET, a relay and a potentiometer.',
      'Мотор через NPN із захисним діодом, світлодіод через MOSFET, реле й потенціометр.',
    ),
  },
};

export interface ProjectTexts {
  title: string;
  description: string;
  warnings?: string[];
}

/** Тексты проекта на языке интерфейса: для демо — из словаря, для проектов ИИ — как есть (ИИ пишет на выбранном языке). */
export function projectTexts(
  projectId: string,
  project: { title: string; description: string; warnings?: { text: string }[] },
  locale: Locale,
): ProjectTexts {
  const d = DEMO[projectId];
  if (!d) return { title: project.title, description: project.description };
  return {
    title: d.title[locale],
    description: d.description[locale],
    warnings: d.warnings?.map((w) => w[locale]),
  };
}

/** Разделы и подразделы каталога (в источнике — по-английски). */
const CATEGORIES: Record<string, [string, string]> = {
  'Connectors & cables': ['Разъёмы и кабели', 'Роз’єми та кабелі'],
  Displays: ['Дисплеи', 'Дисплеї'],
  'Tools & prototyping': ['Инструменты и макетирование', 'Інструменти та макетування'],
  Components: ['Компоненты', 'Компоненти'],
  Sensors: ['Датчики', 'Датчики'],
  Boards: ['Платы', 'Плати'],
  'Wireless & comms': ['Беспроводная связь', 'Бездротовий зв’язок'],
  'Input & controls': ['Ввод и управление', 'Введення та керування'],
  Audio: ['Аудио', 'Аудіо'],
  'Motors & actuators': ['Моторы и приводы', 'Мотори та приводи'],
  Power: ['Питание', 'Живлення'],
  'HATs, Shields & add-ons': ['Шилды и платы расширения', 'Шилди та плати розширення'],
  'Cables & wires': ['Кабели и провода', 'Кабелі та дроти'],
  'Other MCU boards': ['Другие платы с МК', 'Інші плати з МК'],
  Connectors: ['Разъёмы', 'Роз’єми'],
  'Programmers & test sockets': [
    'Программаторы и тестовые панели',
    'Програматори та тестові панелі',
  ],
  'Enclosures & cases': ['Корпуса', 'Корпуси'],
  'TFT & LCD displays': ['TFT и LCD дисплеи', 'TFT та LCD дисплеї'],
  'Addressable LEDs': ['Адресные светодиоды', 'Адресні світлодіоди'],
  'Distance sensors': ['Датчики расстояния', 'Датчики відстані'],
  'Temp, humidity & pressure': ['Температура, влажность, давление', 'Температура, вологість, тиск'],
  'ESP32 boards': ['Платы ESP32', 'Плати ESP32'],
  'Single-board computers': ['Одноплатные компьютеры', 'Одноплатні комп’ютери'],
  'Supplies & regulators': ['Блоки питания и стабилизаторы', 'Блоки живлення та стабілізатори'],
  'Robotics & mechanics': ['Робототехника и механика', 'Робототехніка та механіка'],
  'Cameras & vision': ['Камеры и зрение', 'Камери та зір'],
  'DC & gear motors': [
    'Моторы постоянного тока и редукторные',
    'Мотори постійного струму та редукторні',
  ],
  'Kits & bundles': ['Наборы', 'Набори'],
  'Tools & test equipment': [
    'Инструменты и измерительное оборудование',
    'Інструменти та вимірювальне обладнання',
  ],
  'Wired networking': ['Проводные сети', 'Дротові мережі'],
  'Interface converters': ['Конвертеры интерфейсов', 'Конвертери інтерфейсів'],
  'Gas & air quality': ['Газ и качество воздуха', 'Газ і якість повітря'],
  'Buttons & switches': ['Кнопки и переключатели', 'Кнопки та перемикачі'],
  Batteries: ['Батареи', 'Батареї'],
  'E-paper displays': ['E-paper дисплеи', 'E-paper дисплеї'],
  Servos: ['Сервоприводы', 'Серводвигуни'],
  'LoRa & RF modules': ['Модули LoRa и RF', 'Модулі LoRa та RF'],
  'USB cables': ['USB-кабели', 'USB-кабелі'],
  'Hardware & mounting': ['Крепёж и монтаж', 'Кріплення та монтаж'],
  'LED displays': ['Светодиодные дисплеи', 'Світлодіодні дисплеї'],
  'IMU & motion': ['IMU и движение', 'IMU та рух'],
  'Other components': ['Прочие компоненты', 'Інші компоненти'],
  'Soil & liquid': ['Почва и жидкости', 'Ґрунт і рідини'],
  'Light & color': ['Свет и цвет', 'Світло й колір'],
  'Arduino boards': ['Платы Arduino', 'Плати Arduino'],
  'Motor drivers': ['Драйверы моторов', 'Драйвери моторів'],
  'Bluetooth modules': ['Модули Bluetooth', 'Модулі Bluetooth'],
  'GNSS & GPS': ['GNSS и GPS', 'GNSS та GPS'],
  'Integrated circuits': ['Микросхемы', 'Мікросхеми'],
  'Other sensors': ['Прочие датчики', 'Інші датчики'],
  Cellular: ['Сотовая связь', 'Стільниковий зв’язок'],
  Passives: ['Пассивные компоненты', 'Пасивні компоненти'],
  '3D printing': ['3D-печать', '3D-друк'],
  'Audio boards': ['Аудиоплаты', 'Аудіоплати'],
  Relays: ['Реле', 'Реле'],
  'Chargers & fuel gauges': [
    'Зарядные устройства и датчики заряда',
    'Зарядні пристрої та датчики заряду',
  ],
  'Pico & RP2040 boards': ['Платы Pico и RP2040', 'Плати Pico та RP2040'],
  'Pumps & solenoids': ['Насосы и соленоиды', 'Насоси та соленоїди'],
  'Memory & storage': ['Память и накопители', 'Пам’ять і накопичувачі'],
  'Keypads & controllers': ['Клавиатуры и контроллеры', 'Клавіатури та контролери'],
  'Breadboards & prototyping': ['Макетные платы', 'Макетні плати'],
  'OLED displays': ['OLED дисплеи', 'OLED дисплеї'],
  'Stepper motors': ['Шаговые двигатели', 'Крокові двигуни'],
  'Rotary encoders': ['Энкодеры', 'Енкодери'],
  'Force & weight': ['Сила и вес', 'Сила та вага'],
  'Solar power': ['Солнечная энергия', 'Сонячна енергія'],
  'RTC & timing': ['Часы реального времени', 'Годинники реального часу'],
  'Wi-Fi & networking': ['Wi-Fi и сети', 'Wi-Fi та мережі'],
  'Biometric sensors': ['Биометрические датчики', 'Біометричні датчики'],
  'RFID & NFC': ['RFID и NFC', 'RFID та NFC'],
  'Current & voltage': ['Ток и напряжение', 'Струм і напруга'],
  'Buzzers & speakers': ['Зуммеры и динамики', 'Зумери та динаміки'],
  Infrared: ['Инфракрасные', 'Інфрачервоні'],
  'Logic level converters': ['Преобразователи уровней', 'Перетворювачі рівнів'],
  'Weather & environment': ['Погода и окружающая среда', 'Погода й довкілля'],
  Microphones: ['Микрофоны', 'Мікрофони'],
  'Audio amplifiers': ['Аудиоусилители', 'Аудіопідсилювачі'],
  'Touch sensors': ['Сенсорные датчики', 'Сенсорні датчики'],
};

/** Подпись раздела каталога на языке интерфейса (без перевода остаётся оригинальной). */
export function categoryLabel(name: string, locale: Locale): string {
  if (locale === 'en') return name;
  const t = CATEGORIES[name];
  return t ? t[locale === 'ru' ? 0 : 1] : name;
}
