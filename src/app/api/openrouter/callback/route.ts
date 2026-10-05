import { NextResponse, type NextRequest } from 'next/server';
import { guardSettings } from '@/server/providers/http';
import { PKCE_COOKIE, exchangeCode } from '@/server/providers/openrouter-oauth';
import { checkProvider, createProvider, refreshModels } from '@/server/providers/store';

/** Возврат с OpenRouter: проверяем state, меняем код на ключ, сохраняем провайдера и идём в настройки. */
export async function GET(req: NextRequest) {
  const denied = guardSettings(req);
  if (denied) return denied;
  const url = new URL(req.url);
  const back = (params: Record<string, string>) => {
    const target = new URL('/', url.origin);
    for (const [k, v] of Object.entries(params)) target.searchParams.set(k, v);
    const res = NextResponse.redirect(target);
    res.cookies.delete({ name: PKCE_COOKIE, path: '/api/openrouter' });
    return res;
  };
  let saved: { verifier?: string; state?: string } = {};
  try {
    saved = JSON.parse(req.cookies.get(PKCE_COOKIE)?.value ?? '{}');
  } catch {
    saved = {};
  }
  const code = url.searchParams.get('code');
  if (!code)
    return back({ openrouter: 'error', message: 'OpenRouter did not send an authorization code' });
  if (!saved.verifier || !saved.state || saved.state !== url.searchParams.get('state'))
    return back({
      openrouter: 'error',
      message: 'The sign-in session expired or was tampered with — try again',
    });
  try {
    const key = await exchangeCode(code, saved.verifier);
    const provider = createProvider({ kind: 'openrouter', label: 'OpenRouter', apiKey: key });
    // сразу проверяем и подтягиваем модели — провайдер готов к работе одним действием
    const checked = await checkProvider(provider.id);
    if (checked.lastCheck?.ok) await refreshModels(provider.id).catch(() => undefined);
    return back({ openrouter: 'connected' });
  } catch (e) {
    return back({ openrouter: 'error', message: e instanceof Error ? e.message : String(e) });
  }
}
