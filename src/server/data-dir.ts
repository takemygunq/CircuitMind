import fs from 'node:fs';
import path from 'node:path';

/** Каталог данных сервера (настройки провайдеров, ключ шифрования). CIRCUITMIND_DATA_DIR переопределяет ./data. */
export function dataDir(): string {
  const dir = process.env.CIRCUITMIND_DATA_DIR || path.join(process.cwd(), 'data');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}
