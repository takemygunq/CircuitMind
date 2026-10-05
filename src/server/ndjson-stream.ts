const encoder = new TextEncoder();

/**
 * Ответ-поток NDJSON: `run` получает emit(событие) и сигнал отмены (закрытие соединения клиентом).
 * Пустые строки раз в 15 с — heartbeat, чтобы прокси не рвали молчащее соединение.
 */
export function ndjsonResponse<T extends { type: string }>(
  req: Request,
  run: (emit: (e: T) => void, signal: AbortSignal) => Promise<void>,
  pingMs = 15_000,
): Response {
  const abort = new AbortController();
  let ping: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(ping);
        try {
          controller.close();
        } catch {
          /* клиент уже отключился */
        }
      };
      const emit = (e: T) => {
        if (!closed) controller.enqueue(encoder.encode(JSON.stringify(e) + '\n'));
      };
      ping = setInterval(() => !closed && controller.enqueue(encoder.encode('\n')), pingMs);
      req.signal.addEventListener('abort', () => {
        abort.abort();
        close();
      });
      run(emit, abort.signal)
        .catch(() => undefined) // run обязан сам сообщить об ошибке событием
        .finally(close);
    },
    cancel() {
      abort.abort();
      clearInterval(ping);
    },
  });
  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
    },
  });
}
