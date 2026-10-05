import type { BoardDef, Language } from '../schema';
import { PIN_BLOCK_END, PIN_BLOCK_START, pinExpr, type PinBinding } from './pinmap';

export type FirmwareLintCode =
  | 'empty'
  | 'too_long'
  | 'pin_block_missing'
  | 'pin_constant_missing'
  | 'pin_constant_changed'
  | 'pin_not_wired'
  | 'raw_pin_literal'
  | 'missing_entrypoint'
  | 'wrong_language';

export interface FirmwareIssue {
  severity: 'error' | 'warning';
  code: FirmwareLintCode;
  line?: number;
  params: Record<string, string | number>;
}

export const MAX_FIRMWARE_CHARS = 60_000;

const stripComment = (line: string, language: Language) =>
  language === 'arduino' || language === 'esp-idf'
    ? line.replace(/\/\/.*$/, '')
    : line.replace(/#.*$/, '');
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Номера пинов, использованные как литералы в вызовах работы с пинами (вне блока констант). */
function rawPinUses(line: string, language: Language): string[] {
  const out: string[] = [];
  const push = (re: RegExp) => {
    for (const m of line.matchAll(re)) out.push(m[1]);
  };
  if (language === 'arduino') {
    push(
      /\b(?:pinMode|digitalWrite|digitalRead|analogRead|analogWrite|tone|noTone|pulseIn|touchRead|ledcAttachPin|ledcAttach|dacWrite|attachInterrupt)\s*\(\s*(A?\d+)\b/g,
    );
    for (const m of line.matchAll(/\bWire\.begin\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)/g))
      out.push(m[1], m[2]);
    push(/\.attach\s*\(\s*(\d+)\b/g);
  } else if (language === 'esp-idf') {
    push(
      /\bgpio_(?:set_direction|set_level|get_level|set_pull_mode|reset_pin|set_intr_type)\s*\(\s*GPIO_NUM_(\d+)\b/g,
    );
  } else if (language === 'micropython' || language === 'python') {
    push(/\bPin\s*\(\s*(\d+)\b/g);
    push(/\bsetup\s*\(\s*(\d+)\b/g); // RPi.GPIO
  } else {
    push(/\bboard\.((?:GP|IO)\d+)\b/g);
  }
  return out;
}

/** Совпадает ли литерал из кода с выражением пина (учитывая форму записи). */
const sameToken = (literal: string, expr: string, language: Language) =>
  literal === expr ||
  (language === 'esp-idf' && `GPIO_NUM_${literal}` === expr) ||
  (language === 'circuitpython' && `board.${literal}` === expr);

/**
 * Статические проверки прошивки: блок констант пинов не изменён, нет пинов, которых нет на схеме,
 * есть точка входа и код написан на выбранном языке. Не заменяет компиляцию.
 */
export function lintFirmware(
  code: string,
  language: Language,
  bindings: PinBinding[],
  board: BoardDef,
): FirmwareIssue[] {
  const issues: FirmwareIssue[] = [];
  const add = (
    severity: FirmwareIssue['severity'],
    codeId: FirmwareLintCode,
    params: FirmwareIssue['params'] = {},
    line?: number,
  ) => issues.push({ severity, code: codeId, params, ...(line !== undefined && { line }) });
  void board;

  if (!code.trim()) return [{ severity: 'error', code: 'empty', params: {} }];
  if (code.length > MAX_FIRMWARE_CHARS) add('error', 'too_long', { limit: MAX_FIRMWARE_CHARS });

  const lines = code.split('\n');
  const start = lines.findIndex((l) => l.includes(PIN_BLOCK_START));
  const end = lines.findIndex((l) => l.includes(PIN_BLOCK_END));
  const bound = bindings.flatMap((b) => {
    const expr = pinExpr(b.boardPin, language);
    return expr === undefined ? [] : [{ b, expr }];
  });

  if (bound.length) {
    if (start < 0 || end < start) add('error', 'pin_block_missing');
    else {
      const block = lines.slice(start, end + 1).join('\n');
      for (const { b, expr } of bound) {
        const decl =
          new RegExp(`(?:^|\\s)${esc(b.name)}\\s*=\\s*(?:uint8_t\\()?([A-Za-z0-9_.]+)`, 'm').exec(
            block,
          ) ?? new RegExp(`#define\\s+${esc(b.name)}\\s+([A-Za-z0-9_.]+)`).exec(block);
        if (!decl) add('error', 'pin_constant_missing', { name: b.name, pin: b.boardPin });
        else if (decl[1] !== expr)
          add('error', 'pin_constant_changed', { name: b.name, expected: expr, found: decl[1] });
      }
    }
  }

  // язык и точка входа
  const body = lines.map((l) => stripComment(l, language));
  const text = body.join('\n');
  if (language === 'arduino') {
    if (!/\bvoid\s+setup\s*\(/.test(text) || !/\bvoid\s+loop\s*\(/.test(text))
      add('error', 'missing_entrypoint', { entry: 'setup() / loop()' });
    if (/^\s*(import|from)\s+\w+/m.test(text) || /^\s*def\s+\w+\s*\(/m.test(text))
      add('error', 'wrong_language', { expected: 'Arduino C++' });
  } else if (language === 'esp-idf') {
    if (!/\bapp_main\s*\(/.test(text)) add('error', 'missing_entrypoint', { entry: 'app_main()' });
    if (/^\s*(import|from)\s+\w+/m.test(text))
      add('error', 'wrong_language', { expected: 'ESP-IDF C' });
  } else {
    if (/^\s*#include\b/m.test(code) || /\bvoid\s+(setup|loop)\s*\(/.test(text))
      add('error', 'wrong_language', {
        expected:
          language === 'micropython'
            ? 'MicroPython'
            : language === 'circuitpython'
              ? 'CircuitPython'
              : 'Python',
      });
  }

  // пины, использованные в коде напрямую
  const wired = new Set(bound.map((x) => x.expr));
  const isPreamble = (i: number) => start >= 0 && i >= start && i <= end;
  body.forEach((line, i) => {
    if (isPreamble(i)) return;
    for (const lit of rawPinUses(line, language)) {
      const hit = bound.find((x) => sameToken(lit, x.expr, language));
      if (hit) add('warning', 'raw_pin_literal', { pin: lit, name: hit.b.name }, i + 1);
      else if (!wired.has(lit) && !wired.has(`GPIO_NUM_${lit}`))
        add('error', 'pin_not_wired', { pin: lit }, i + 1);
    }
  });
  return issues;
}

export const hasErrors = (issues: FirmwareIssue[]): boolean =>
  issues.some((i) => i.severity === 'error');

export function describeIssue(i: FirmwareIssue): string {
  const p = i.params;
  const at = i.line ? ` (line ${i.line})` : '';
  switch (i.code) {
    case 'empty':
      return 'The firmware is empty.';
    case 'too_long':
      return `The firmware is longer than ${p.limit} characters.`;
    case 'pin_block_missing':
      return `The generated pin block ("${PIN_BLOCK_START}") is missing. Keep it at the top of the file unchanged.`;
    case 'pin_constant_missing':
      return `Pin constant ${p.name} (${p.pin}) is missing from the generated pin block.`;
    case 'pin_constant_changed':
      return `Pin constant ${p.name} must stay ${p.expected} to match the wiring, but it is ${p.found}.`;
    case 'pin_not_wired':
      return `Pin ${p.pin} is used${at} but nothing is wired to it in the project. Use only the constants from the pin block.`;
    case 'raw_pin_literal':
      return `Pin ${p.pin} is hard-coded${at}; use the constant ${p.name} instead.`;
    case 'missing_entrypoint':
      return `The entry point ${p.entry} is missing.`;
    case 'wrong_language':
      return `The code is not valid ${p.expected}.`;
  }
}
