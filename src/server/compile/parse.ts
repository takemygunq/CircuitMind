import type { CompileDiagnostic, CompileSizes } from './types';

const DIAG = /^(?:.*[/\\])?sketch\.ino:(\d+):(?:(\d+):)?\s*(fatal error|error|warning):\s*(.+)$/;

/** Диагностика gcc по основному файлу скетча; ошибки библиотек и ядра не показываем (там пользователь ничего не правит). */
export function parseDiagnostics(log: string, max = 50): CompileDiagnostic[] {
  const out: CompileDiagnostic[] = [];
  for (const raw of log.split('\n')) {
    const m = DIAG.exec(raw.trim());
    if (!m) continue;
    out.push({
      severity: m[3] === 'warning' ? 'warning' : 'error',
      line: Number(m[1]),
      ...(m[2] && { column: Number(m[2]) }),
      message: m[4].trim(),
    });
    if (out.length >= max) break;
  }
  return out;
}

/** «Sketch uses 1234 bytes … Maximum is 32256 bytes.» + «Global variables use … Maximum is 2048 bytes.» */
export function parseSizes(log: string): CompileSizes | undefined {
  const flash = /Sketch uses (\d+) bytes[^\n]*?Maximum is (\d+) bytes/.exec(log);
  if (!flash) return undefined;
  const ram = /Global variables use (\d+) bytes[^\n]*?Maximum is (\d+) bytes/.exec(log);
  return {
    flashUsed: Number(flash[1]),
    flashMax: Number(flash[2]),
    ...(ram && { ramUsed: Number(ram[1]), ramMax: Number(ram[2]) }),
  };
}
