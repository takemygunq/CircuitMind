import { en } from './en';
import { ru } from './ru';
import { uk } from './uk';

export type Locale = 'ru' | 'uk' | 'en';
export type MessageKey = keyof typeof ru;
export const LOCALES: { id: Locale; label: string }[] = [
  { id: 'ru', label: 'Русский' },
  { id: 'uk', label: 'Українська' },
  { id: 'en', label: 'English' },
];

const dictionaries: Record<Locale, Record<MessageKey, string>> = { ru, uk, en };

export function translate(
  locale: Locale,
  key: MessageKey,
  vars?: Record<string, string | number>,
): string {
  const text = dictionaries[locale][key] ?? ru[key];
  return vars ? text.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`)) : text;
}
