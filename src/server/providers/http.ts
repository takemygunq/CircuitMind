import { ZodError } from 'zod';
import { NotFoundError } from './store';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Настройки провайдеров меняют, куда уходят ключи и какие программы запускаются (CLI-мосты), поэтому
 * по умолчанию доступны только с этого же компьютера и только со своей страницы (защита от чужих сайтов и DNS rebinding).
 * Для сервера в сети: CIRCUITMIND_ALLOW_REMOTE_SETTINGS=1 (только за собственной авторизацией).
 */
export function guardSettings(req: Request): Response | null {
  if (process.env.CIRCUITMIND_ALLOW_REMOTE_SETTINGS === '1') return null;
  const url = new URL(req.url);
  if (!LOCAL_HOSTS.has(url.hostname))
    return Response.json({ error: 'settings_local_only' }, { status: 403 });
  const origin = req.headers.get('origin');
  if (origin && req.method !== 'GET' && new URL(origin).host !== url.host)
    return Response.json({ error: 'cross_origin' }, { status: 403 });
  return null;
}

/** Выполняет обработчик и превращает ошибки в JSON-ответы. */
export async function handle(
  req: Request,
  fn: () => unknown | Promise<unknown>,
): Promise<Response> {
  const denied = guardSettings(req);
  if (denied) return denied;
  try {
    return Response.json(await fn());
  } catch (e) {
    if (e instanceof ZodError)
      return Response.json(
        { error: 'invalid_request', issues: e.issues.slice(0, 5) },
        { status: 400 },
      );
    if (e instanceof NotFoundError) return Response.json({ error: 'not_found' }, { status: 404 });
    const message = e instanceof Error ? e.message : String(e);
    return Response.json(
      { error: 'provider_error', message: message.slice(0, 400) },
      { status: 502 },
    );
  }
}
