export class HexError extends Error {}

/**
 * Разбор Intel HEX в образ памяти программ. Проверяет контрольные суммы, типы записей и границы.
 * @param size размер flash в байтах (для ATmega328P — 32768)
 */
export function parseIntelHex(hex: string, size = 32768): Uint8Array {
  const image = new Uint8Array(size).fill(0xff);
  let upper = 0;
  let eof = false;
  const lines = hex.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const at = `line ${i + 1}`;
    if (eof) throw new HexError(`data after the end-of-file record (${at})`);
    if (line[0] !== ':' || line.length < 11 || line.length % 2 === 0)
      throw new HexError(`malformed record (${at})`);
    const bytes = new Uint8Array(line.length >> 1);
    for (let k = 0; k < bytes.length; k++) {
      const v = Number.parseInt(line.substr(1 + k * 2, 2), 16);
      if (Number.isNaN(v)) throw new HexError(`non-hex digit (${at})`);
      bytes[k] = v;
    }
    const len = bytes[0];
    if (bytes.length !== len + 5) throw new HexError(`length mismatch (${at})`);
    if (bytes.reduce((s, b) => (s + b) & 0xff, 0) !== 0)
      throw new HexError(`checksum mismatch (${at})`);
    const addr = (bytes[1] << 8) | bytes[2];
    switch (bytes[3]) {
      case 0x00: {
        const base = upper + addr;
        if (base + len > size) throw new HexError(`record beyond flash size ${size} (${at})`);
        image.set(bytes.subarray(4, 4 + len), base);
        break;
      }
      case 0x01:
        eof = true;
        break;
      case 0x02:
        upper = ((bytes[4] << 8) | bytes[5]) << 4;
        break;
      case 0x04:
        upper = ((bytes[4] << 8) | bytes[5]) << 16;
        break;
      case 0x03:
      case 0x05:
        break; // начальный адрес запуска — не нужен
      default:
        throw new HexError(`unsupported record type ${bytes[3]} (${at})`);
    }
  });
  if (!eof) throw new HexError('missing end-of-file record');
  return image;
}
