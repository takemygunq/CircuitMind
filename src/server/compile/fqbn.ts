/** Плата библиотеки → FQBN arduino-cli. Для платы нужно установленное ядро в образе компилятора. */
export const FQBN_BY_BOARD: Record<string, string> = {
  'arduino-uno': 'arduino:avr:uno',
  'arduino-nano': 'arduino:avr:nano:cpu=atmega328',
  'esp32-devkit-v1': 'esp32:esp32:esp32',
  'raspberry-pi-pico': 'rp2040:rp2040:rpipico',
};

/** Какие FQBN реально собираются в текущем образе (по умолчанию — AVR). Переопределяется COMPILER_FQBNS="a,b". */
export function supportedFqbns(env: Record<string, string | undefined> = process.env): string[] {
  return (env.COMPILER_FQBNS ?? 'arduino:avr:uno,arduino:avr:nano:cpu=atmega328')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** FQBN платы, если для неё есть ядро в образе; иначе undefined. */
export function fqbnFor(
  boardId: string,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const fqbn = FQBN_BY_BOARD[boardId];
  return fqbn && supportedFqbns(env).includes(fqbn) ? fqbn : undefined;
}
