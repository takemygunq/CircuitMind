import type { PinFunction } from '../../schema';
import type { ErcContext } from '../context';

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Функции, которые нужно «получить» у пина платы. Остальные (gpio/other) — универсальны. */
const BOARD_FUNCTION_FOR: Partial<Record<PinFunction, PinFunction>> = {
  i2c_sda: 'i2c_sda',
  i2c_scl: 'i2c_scl',
  spi_mosi: 'spi_mosi',
  spi_miso: 'spi_miso',
  spi_sck: 'spi_sck',
  spi_cs: 'spi_cs',
  uart_tx: 'uart_rx', // TX устройства соединяется с RX платы
  uart_rx: 'uart_tx',
  pwm: 'pwm',
  adc: 'adc',
  dac: 'dac',
};
/** Аппаратные шины, которые на «гибких» платах (ESP32) назначаются на любые пины. */
const BUS_FUNCTIONS = new Set<PinFunction>([
  'i2c_sda',
  'i2c_scl',
  'spi_mosi',
  'spi_miso',
  'spi_sck',
  'spi_cs',
  'uart_tx',
  'uart_rx',
]);

export function structureRules(ctx: ErcContext): void {
  const { project, board } = ctx;

  for (const { inst, def } of ctx.parts.values()) {
    if (!def) ctx.add('unknown_component', 'error', [inst.instanceId], { id: inst.componentId });
    else if (!def.verified)
      ctx.add('unverified_component', 'warning', [inst.instanceId], { part: def.name });
  }

  for (const conn of project.connections)
    for (const side of [conn.from, conn.to]) {
      const e = ctx.ep(side);
      const known = e.isBoard || e.def;
      if (known && !e.pin) ctx.add('unknown_pin', 'error', [side], { endpoint: side });
    }

  // замыкания и конфликты драйверов
  for (const net of ctx.nets.nets) {
    const eps = ctx.netEps(net.id);
    const gnd = eps.find((e) => e.isBoard && ctx.isGnd(e));
    const supplies = eps.filter((e) => e.isBoard && ctx.isSupplyPin(e));
    const volts = supplies.map((e) => ctx.supplyVoltage(e) ?? 0);
    if (gnd && supplies.some((_, i) => volts[i] > 0)) {
      ctx.add('short_circuit', 'error', [gnd.endpoint, ...supplies.map((s) => s.endpoint)], {
        a: gnd.endpoint,
        b: supplies.map((s) => s.endpoint).join(', '),
      });
    } else if (supplies.length > 1 && Math.max(...volts) - Math.min(...volts) > 0.05) {
      ctx.add(
        'short_circuit',
        'error',
        supplies.map((s) => s.endpoint),
        { a: supplies[0].endpoint, b: supplies[1].endpoint },
      );
    }
    const boardSignals = eps.filter(
      (e) => e.isBoard && !ctx.isGnd(e) && !ctx.isSupplyPin(e) && e.pin?.functions.includes('gpio'),
    );
    const outputs = eps.filter((e) => !e.isBoard && e.pin?.electrical === 'output');
    if (boardSignals.length > 1)
      ctx.add(
        'multiple_drivers',
        'error',
        boardSignals.map((e) => e.endpoint),
        { a: boardSignals[0].endpoint, b: boardSignals[1].endpoint },
      );
    else if (outputs.length > 1)
      ctx.add(
        'multiple_drivers',
        'error',
        outputs.map((e) => e.endpoint),
        { a: outputs[0].endpoint, b: outputs[1].endpoint },
      );
  }

  // обязательные выводы питания и земли у деталей
  for (const { inst, def } of ctx.knownParts()) {
    const connected = (pinId: string) => ctx.netOf(inst.instanceId, pinId) !== undefined;
    const gnds = def.pins.filter((p) => p.electrical === 'gnd');
    if (gnds.length && !gnds.some((p) => connected(p.id)))
      ctx.add('unconnected_required', 'error', [inst.instanceId], {
        part: inst.instanceId,
        pin: gnds[0].label,
      });
    for (const p of def.pins.filter((p) => p.electrical === 'power_in'))
      if (!connected(p.id))
        ctx.add('unconnected_required', 'error', [inst.instanceId], {
          part: inst.instanceId,
          pin: p.label,
        });

    // напряжение питания детали
    const min = ctx.param(def, 'supplyMinV');
    const max = ctx.param(def, 'supplyMaxV');
    if (min === undefined && max === undefined) continue;
    for (const p of def.pins.filter((p) => p.electrical === 'power_in')) {
      const v = ctx.netVoltage(ctx.netOf(inst.instanceId, p.id));
      if (v === undefined || v <= 0) continue;
      if ((min !== undefined && v < min - 1e-6) || (max !== undefined && v > max + 1e-6))
        ctx.add('part_supply_voltage', 'error', [`${inst.instanceId}:${p.id}`], {
          part: def.name,
          v: r2(v),
          min: min ?? 0,
          max: max ?? 0,
        });
    }
  }

  if (
    project.power.source !== 'usb' &&
    (project.power.voltage < board.supply.min || project.power.voltage > board.supply.max)
  )
    ctx.add('supply_out_of_range', 'error', ['board'], {
      v: project.power.voltage,
      min: board.supply.min,
      max: board.supply.max,
      board: board.name,
    });

  // функции пинов: шина/ШИМ/АЦП должны попадать на пин платы с такой функцией
  for (const net of ctx.nets.nets) {
    const eps = ctx.netEps(net.id);
    const boardPins = eps.filter((e) => e.isBoard && !ctx.isGnd(e) && !ctx.isSupplyPin(e));
    const parts = eps.filter((e) => !e.isBoard && e.pin);
    for (const bp of boardPins)
      for (const pp of parts)
        for (const fn of pp.pin!.functions) {
          const need = BOARD_FUNCTION_FOR[fn];
          if (!need || bp.pin!.functions.includes(need)) continue;
          if (board.flexibleMux && BUS_FUNCTIONS.has(fn)) continue;
          ctx.add('function_mismatch', 'error', [bp.endpoint, pp.endpoint], {
            fn: need,
            pin: bp.pin!.id,
            part: pp.endpoint,
          });
        }
  }
}
