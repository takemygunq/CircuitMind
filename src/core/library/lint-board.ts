import type { ArtPart, BoardDef } from '../schema';

export interface BoardLintResult {
  errors: string[];
  warnings: string[];
}

const OVERHANG_MM = 4; // разъёмы USB/питания выступают за край платы

function rectOf(p: ArtPart): { x0: number; y0: number; x1: number; y1: number } | null {
  if (p.type === 'chip' || p.type === 'module' || p.type === 'crystal' || p.type === 'smd')
    return { x0: p.x - p.w / 2, y0: p.y - p.h / 2, x1: p.x + p.w / 2, y1: p.y + p.h / 2 };
  return null;
}

/**
 * Детерминированная проверка платы (особенно сгенерированной ИИ) сверх Zod-схемы.
 * Ошибки возвращаются ИИ на исправление, предупреждения показываются в UI.
 */
export function lintBoard(board: BoardDef): BoardLintResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { width: W, height: H } = board.size;

  if (W < 10 || W > 200 || H < 10 || H > 200)
    errors.push(`board size ${W}x${H} mm is implausible (expected 10–200 mm per side)`);

  // пины
  for (let i = 0; i < board.pins.length; i++)
    for (let j = i + 1; j < board.pins.length; j++) {
      const a = board.pins[i];
      const b = board.pins[j];
      if (Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y) < 1.0)
        errors.push(
          `pins ${a.id} and ${b.id} are less than 1 mm apart — check header origin/pitch/gapBefore`,
        );
    }
  const physical = new Map<number, string>();
  for (const p of board.pins) {
    if (p.physicalPin !== undefined) {
      const prev = physical.get(p.physicalPin);
      if (prev) errors.push(`physicalPin ${p.physicalPin} used by both ${prev} and ${p.id}`);
      physical.set(p.physicalPin, p.id);
    }
    if (p.functions.includes('gnd') && p.electrical !== 'gnd')
      errors.push(`pin ${p.id} has function gnd but electrical is "${p.electrical ?? 'unset'}"`);
    if (
      p.functions.includes('gpio') &&
      p.voltage !== undefined &&
      Math.abs(p.voltage - board.logicVoltage) > 0.01
    )
      errors.push(
        `GPIO ${p.id} voltage ${p.voltage} V differs from board logicVoltage ${board.logicVoltage} V`,
      );
    if (p.functions.includes('gpio') && p.electrical === undefined)
      warnings.push(`GPIO ${p.id} has no electrical role`);
    if (p.maxCurrentMa !== undefined && p.maxCurrentMa > 40)
      warnings.push(`pin ${p.id} maxCurrentMa ${p.maxCurrentMa} is unusually high`);
  }
  if (!board.pins.some((p) => p.functions.includes('gnd'))) errors.push('board has no GND pin');
  if (board.pins.filter((p) => p.functions.includes('gpio')).length < 2)
    errors.push('board has fewer than 2 GPIO pins');
  const has = (f: string) => board.pins.some((p) => (p.functions as string[]).includes(f));
  if (has('i2c_sda') !== has('i2c_scl')) errors.push('I2C needs both i2c_sda and i2c_scl pins');
  if (has('spi_mosi') && !has('spi_sck')) errors.push('SPI pins present but no spi_sck');
  if (has('uart_tx') !== has('uart_rx')) errors.push('UART needs both uart_tx and uart_rx pins');
  if (board.supply.min >= board.supply.max) errors.push('supply.min must be lower than supply.max');
  for (const r of board.rails) {
    const pin = board.pins.find((p) => p.id === r.pinId);
    if (pin && pin.electrical !== 'power_out')
      warnings.push(`rail pin ${r.pinId} is not marked power_out`);
  }

  // внешний вид
  const art = board.art;
  if (!art) {
    warnings.push('board has no art — a simplified drawing will be used');
  } else {
    if (art.parts.length > 80) errors.push(`art has ${art.parts.length} parts (max 80)`);
    art.parts.forEach((part, i) => {
      const at = `art.parts[${i}] (${part.type})`;
      const overhang = part.type === 'usb' || part.type === 'barrel' ? OVERHANG_MM : 0.5;
      if (
        part.x < -overhang ||
        part.x > W + overhang ||
        part.y < -overhang ||
        part.y > H + overhang
      )
        errors.push(`${at} center (${part.x}, ${part.y}) is outside the ${W}x${H} mm board`);
      const r = rectOf(part);
      if (!r) return;
      if (r.x0 < -0.5 || r.y0 < -0.5 || r.x1 > W + 0.5 || r.y1 > H + 0.5)
        errors.push(`${at} extends beyond the board edge`);
      if (part.type === 'chip' || part.type === 'module') {
        const covered = board.pins.filter(
          (p) =>
            p.position.x > r.x0 - 0.5 &&
            p.position.x < r.x1 + 0.5 &&
            p.position.y > r.y0 - 0.5 &&
            p.position.y < r.y1 + 0.5,
        );
        if (covered.length)
          errors.push(
            `${at} covers pin(s) ${covered.map((p) => p.id).join(', ')} — move it away from the headers`,
          );
      }
    });
    if (art.pinStyle === 'castellated')
      for (const p of board.pins) {
        const edge = Math.min(p.position.x, W - p.position.x, p.position.y, H - p.position.y);
        if (edge > 3)
          warnings.push(`castellated pin ${p.id} is ${edge.toFixed(1)} mm from the edge`);
      }
  }
  return { errors, warnings };
}
