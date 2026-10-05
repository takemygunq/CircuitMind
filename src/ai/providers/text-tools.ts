import type Anthropic from '@anthropic-ai/sdk';
import type { ModelRequest } from '../agent/model-client';
import { blocksOf, makeMessage, newToolId, resultText, textBlock, toolUseBlock } from './message';

/**
 * Эмуляция tool use для моделей без него (CLI-мосты): инструменты описываются в промпте, модель отвечает
 * одним JSON-объектом {text, tool_calls}. Вызовы превращаются обратно в tool_use-блоки — агент ничего не замечает.
 */

export function envelopeSchema(tools: ModelRequest['tools']): object {
  return {
    type: 'object',
    properties: {
      text: { type: 'string' },
      tool_calls: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', ...(tools.length && { enum: tools.map((t) => t.name) }) },
            input: { type: 'object' },
          },
          required: ['name', 'input'],
        },
      },
    },
    required: ['tool_calls'],
  };
}

const describeTools = (tools: ModelRequest['tools']) =>
  tools
    .map(
      (t) =>
        `### ${t.name}\n${t.description ?? ''}\nInput JSON Schema: ${JSON.stringify(t.input_schema)}`,
    )
    .join('\n\n');

/** Весь диалог одним текстом: у CLI нет структурированных сообщений. */
export function renderTranscript(messages: Anthropic.MessageParam[]): string {
  const names = new Map<string, string>();
  const out: string[] = [];
  for (const m of messages) {
    const blocks = blocksOf(m.content);
    if (m.role === 'assistant') {
      const calls = blocks.flatMap((b) => {
        if (b.type !== 'tool_use') return [];
        names.set(b.id, b.name);
        return [{ name: b.name, input: b.input }];
      });
      const text = blocks.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
      out.push('## Your previous reply', JSON.stringify({ text, tool_calls: calls }), '');
    } else {
      for (const b of blocks) {
        if (b.type === 'tool_result')
          out.push(
            `## Tool result: ${names.get(b.tool_use_id) ?? b.tool_use_id}${b.is_error ? ' (ERROR)' : ''}`,
            resultText(b.content),
            '',
          );
      }
      const text = blocks.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n');
      if (text) out.push('## User', text, '');
    }
  }
  return out.join('\n');
}

/** Системная часть и диалог для одного запроса к CLI. */
export function renderToolPrompt(req: Pick<ModelRequest, 'system' | 'tools' | 'messages'>): {
  system: string;
  prompt: string;
} {
  const system = [
    req.system,
    '',
    '# Tools',
    'You cannot call tools natively. To call tools, answer with ONE JSON object and nothing else (no markdown fences):',
    '{"text": "<short note, may be empty>", "tool_calls": [{"name": "<tool>", "input": { ... }}]}',
    'You may put several calls into tool_calls; their results arrive in the next message. When you need no more tools, send "tool_calls": [].',
    '',
    describeTools(req.tools),
  ].join('\n');
  return { system, prompt: renderTranscript(req.messages) };
}

/** Достаёт JSON-объект из ответа, даже если модель обернула его в ``` или добавила пояснение. */
export function extractJson(text: string): unknown {
  const t = text.trim();
  const candidates = [t, t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')];
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(t.slice(start, end + 1));
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      /* пробуем следующий вариант */
    }
  }
  return undefined;
}

export function parseEnvelope(
  raw: string,
  model: string,
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens?: number },
): Anthropic.Message {
  const parsed = extractJson(raw) as { text?: unknown; tool_calls?: unknown } | undefined;
  const content: Anthropic.ContentBlock[] = [];
  if (!parsed || typeof parsed !== 'object') {
    // не JSON — считаем обычным текстом: агент попросит прислать результат инструментом
    if (raw.trim()) content.push(textBlock(raw.trim()));
    return makeMessage(model, content, 'end_turn', usage);
  }
  if (typeof parsed.text === 'string' && parsed.text.trim()) content.push(textBlock(parsed.text));
  if (Array.isArray(parsed.tool_calls))
    for (const c of parsed.tool_calls) {
      if (!c || typeof c !== 'object' || typeof (c as { name?: unknown }).name !== 'string')
        continue;
      const call = c as { name: string; input?: unknown };
      content.push(toolUseBlock(newToolId('cli'), call.name, call.input ?? {}));
    }
  return makeMessage(
    model,
    content,
    content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn',
    usage,
  );
}
