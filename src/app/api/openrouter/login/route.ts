import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { guardSettings } from '@/server/providers/http';
import { PKCE_COOKIE, authorizeUrl, createVerifier } from '@/server/providers/openrouter-oauth';

/** «Войти через OpenRouter»: PKCE и переход на страницу авторизации OpenRouter. */
export async function GET(req: Request) {
  const denied = guardSettings(req);
  if (denied) return denied;
  const origin = new URL(req.url).origin;
  const verifier = createVerifier();
  const state = crypto.randomBytes(16).toString('hex');
  const res = NextResponse.redirect(
    authorizeUrl(`${origin}/api/openrouter/callback`, verifier, state),
  );
  res.cookies.set(PKCE_COOKIE, JSON.stringify({ verifier, state }), {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 10 * 60,
    path: '/api/openrouter',
  });
  return res;
}
