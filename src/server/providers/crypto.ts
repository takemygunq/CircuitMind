import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from '../data-dir';

const KEY_FILE = 'secret.key';
const VERSION = 'v1';
let cachedKey: Buffer | null = null;
let cachedDir = '';

/** Ключ AES-256 лежит отдельным файлом в data/ и создаётся при первом запуске. */
function encryptionKey(): Buffer {
  const dir = dataDir();
  if (cachedKey && cachedDir === dir) return cachedKey;
  const file = path.join(dir, KEY_FILE);
  if (!fs.existsSync(file)) {
    try {
      fs.writeFileSync(file, crypto.randomBytes(32).toString('base64'), {
        mode: 0o600,
        flag: 'wx',
      });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; // параллельный запрос успел раньше
    }
  }
  const key = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64');
  if (key.length !== 32) throw new Error(`The encryption key file is corrupted: ${file}`);
  cachedKey = key;
  cachedDir = dir;
  return key;
}

/** Формат: v1:<iv>:<authTag>:<ciphertext> (base64). */
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [
    VERSION,
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    data.toString('base64'),
  ].join(':');
}

export function decryptSecret(payload: string): string {
  const [version, iv, tag, data] = payload.split(':');
  if (version !== VERSION || !iv || !tag || data === undefined)
    throw new Error('Unknown secret format');
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString(
    'utf8',
  );
}

/** Для показа в интерфейсе: только хвост ключа. */
export function maskSecret(plain: string): string {
  return plain.length <= 8 ? '••••' : `••••${plain.slice(-4)}`;
}
