import Anthropic from '@anthropic-ai/sdk';

/** Один ход модели: полный Message после стриминга. Абстракция нужна для тестов и режима без ключа. */
export interface ModelRequest {
  system: string;
  tools: Anthropic.Tool[];
  messages: Anthropic.MessageParam[];
  signal?: AbortSignal;
  /** Дельты текста ассистента (для живого статуса). */
  onText?: (delta: string) => void;
}
export interface ModelClient {
  readonly model: string;
  turn(req: ModelRequest): Promise<Anthropic.Message>;
}

export function defaultModel(): string {
  return process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
}

/**
 * Реальный клиент Claude. Стриминг (ответы большие), eager_input_streaming у инструментов,
 * автокэширование префикса (tools → system → messages) для многоходового цикла.
 * Ключ берётся из окружения сервера (ANTHROPIC_API_KEY) — на клиент он не попадает.
 */
export function createAnthropicModelClient(
  opts: { client?: Anthropic; model?: string; maxTokens?: number } = {},
): ModelClient {
  const client = opts.client ?? new Anthropic();
  const model = opts.model ?? defaultModel();
  return {
    model,
    async turn({ system, tools, messages, signal, onText }) {
      const stream = client.messages.stream(
        {
          model,
          max_tokens: opts.maxTokens ?? 32000,
          system,
          tools,
          messages,
          cache_control: { type: 'ephemeral' },
        },
        { signal },
      );
      if (onText) stream.on('text', onText);
      return stream.finalMessage();
    },
  };
}
