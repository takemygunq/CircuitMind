'use client';

import { useCallback } from 'react';
import { translate, type MessageKey } from '@/i18n';
import { useWorkspace } from '@/store/workspace';

export function useT() {
  const locale = useWorkspace((s) => s.locale);
  return useCallback(
    (key: MessageKey, vars?: Record<string, string | number>) => translate(locale, key, vars),
    [locale],
  );
}
