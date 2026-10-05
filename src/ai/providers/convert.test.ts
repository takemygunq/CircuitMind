import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { fromGeminiResponse, toGeminiContents, toGeminiTools } from './gemini-convert';
import { fromOpenAIResponse, toOpenAIMessages, toOpenAITools } from './openai-convert';
import { envelopeSchema, extractJson, parseEnvelope, renderToolPrompt } from './text-tools';

const tools = [
  {
    name: 'calculate',
    description: 'Calc',
    input_schema: { type: 'object', properties: { type: { type: 'string' } } },
  },
] as Anthropic.Tool[];

const history: Anthropic.MessageParam[] = [
  { role: 'user', content: 'Design a blinker' },
  {
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: 'hmm', signature: 's' },
      { type: 'text', text: 'Let me calculate.' },
      { type: 'tool_use', id: 'c1', name: 'calculate', input: { type: 'led_resistor' } },
    ] as Anthropic.ContentBlockParam[],
  },
  {
    role: 'user',
    content: [
      { type: 'tool_result', tool_use_id: 'c1', content: '{"value":150}' },
      { type: 'text', text: 'continue' },
    ],
  },
];

describe('OpenAI conversion', () => {
  it('maps tool calls and results to the chat format', () => {
    const msgs = toOpenAIMessages('SYS', history);
    expect(msgs[0]).toEqual({ role: 'system', content: 'SYS' });
    expect(msgs[1]).toEqual({ role: 'user', content: 'Design a blinker' });
    expect(msgs[2]).toMatchObject({
      role: 'assistant',
      content: 'Let me calculate.',
      tool_calls: [
        {
          id: 'c1',
          type: 'function',
          function: { name: 'calculate', arguments: '{"type":"led_resistor"}' },
        },
      ],
    });
    // результат инструмента идёт строго после assistant, текст пользователя — после него
    expect(msgs[3]).toEqual({ role: 'tool', tool_call_id: 'c1', content: '{"value":150}' });
    expect(msgs[4]).toEqual({ role: 'user', content: 'continue' });
  });

  it('marks tool errors and converts tool schemas', () => {
    const msgs = toOpenAIMessages('S', [
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'x', is_error: true, content: 'bad' }],
      },
    ]);
    expect(msgs[1]).toMatchObject({ role: 'tool', content: 'ERROR: bad' });
    expect(toOpenAITools(tools)[0]).toEqual({
      type: 'function',
      function: { name: 'calculate', description: 'Calc', parameters: tools[0].input_schema },
    });
  });

  it('turns a response into an Anthropic message', () => {
    const res = {
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            content: 'ok',
            tool_calls: [
              {
                id: 't1',
                type: 'function',
                function: { name: 'calculate', arguments: '{"type":"x"}' },
              },
              { id: 't2', type: 'function', function: { name: 'calculate', arguments: '{broken' } },
            ],
          },
        },
      ],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 20,
        prompt_tokens_details: { cached_tokens: 60 },
      },
    } as never;
    const m = fromOpenAIResponse(res, 'openai:gpt');
    expect(m.stop_reason).toBe('tool_use');
    expect(m.content.map((b) => b.type)).toEqual(['text', 'tool_use', 'tool_use']);
    expect(m.content[1]).toMatchObject({ id: 't1', input: { type: 'x' } });
    expect(m.content[2]).toMatchObject({ input: { __invalid_json: '{broken' } });
    expect(m.usage).toMatchObject({
      input_tokens: 100,
      output_tokens: 20,
      cache_read_input_tokens: 60,
    });
  });

  it('maps finish reasons', () => {
    const r = (finish: string, extra = {}) =>
      fromOpenAIResponse(
        { choices: [{ finish_reason: finish, message: { content: 'x', ...extra } }] } as never,
        'm',
      );
    expect(r('length').stop_reason).toBe('max_tokens');
    expect(r('stop').stop_reason).toBe('end_turn');
    expect(r('content_filter').stop_reason).toBe('refusal');
    expect(r('stop', { refusal: 'no' }).stop_reason).toBe('refusal');
  });
});

describe('Gemini conversion', () => {
  it('maps history with function names and keeps thought signatures', () => {
    const withSig: Anthropic.MessageParam[] = [
      history[0],
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'c1',
            name: 'calculate',
            input: { a: 1 },
            thoughtSignature: 'SIG',
          },
        ] as never,
      },
      history[2],
    ];
    const c = toGeminiContents(withSig);
    expect(c[0]).toEqual({ role: 'user', parts: [{ text: 'Design a blinker' }] });
    expect(c[1]).toEqual({
      role: 'model',
      parts: [{ functionCall: { name: 'calculate', args: { a: 1 } }, thoughtSignature: 'SIG' }],
    });
    expect(c[2].parts).toEqual([
      { functionResponse: { name: 'calculate', response: { output: '{"value":150}' } } },
      { text: 'continue' },
    ]);
    expect(toGeminiTools(tools)[0]).toMatchObject({
      name: 'calculate',
      parametersJsonSchema: tools[0].input_schema,
    });
  });

  it('parses a response with a function call', () => {
    const m = fromGeminiResponse(
      {
        candidates: [
          {
            finishReason: 'STOP',
            content: {
              parts: [
                { text: 'thinking', thought: true },
                { text: 'Calling. ' },
                {
                  functionCall: { name: 'calculate', args: { type: 'x' } },
                  thoughtSignature: 'S1',
                },
              ],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 3 },
      } as never,
      'gemini:m',
    );
    expect(m.stop_reason).toBe('tool_use');
    expect(m.content[0]).toMatchObject({ type: 'text', text: 'Calling. ' });
    expect(m.content[1]).toMatchObject({
      type: 'tool_use',
      name: 'calculate',
      input: { type: 'x' },
      thoughtSignature: 'S1',
    });
    expect(m.usage.output_tokens).toBe(8);
    expect(
      fromGeminiResponse({ candidates: [{ finishReason: 'MAX_TOKENS' }] } as never, 'm')
        .stop_reason,
    ).toBe('max_tokens');
    expect(
      fromGeminiResponse({ promptFeedback: { blockReason: 'SAFETY' } } as never, 'm').stop_reason,
    ).toBe('refusal');
  });
});

describe('text tool emulation (CLI bridges)', () => {
  it('renders tools and the transcript, then parses the JSON envelope', () => {
    const { system, prompt } = renderToolPrompt({ system: 'BASE', tools, messages: history });
    expect(system).toContain('BASE');
    expect(system).toContain('### calculate');
    expect(prompt).toContain('"tool_calls":[{"name":"calculate","input":{"type":"led_resistor"}}]');
    expect(prompt).toContain('## Tool result: calculate');
    expect(envelopeSchema(tools)).toMatchObject({
      properties: { tool_calls: { items: { properties: { name: { enum: ['calculate'] } } } } },
    });

    const m = parseEnvelope(
      '```json\n{"text":"hi","tool_calls":[{"name":"calculate","input":{"type":"y"}},{"bad":1}]}\n```',
      'cli',
      {
        inputTokens: 1,
        outputTokens: 2,
      },
    );
    expect(m.stop_reason).toBe('tool_use');
    expect(m.content).toHaveLength(2);
    expect(m.content[1]).toMatchObject({
      type: 'tool_use',
      name: 'calculate',
      input: { type: 'y' },
    });
  });

  it('treats non-JSON as plain text and extracts JSON from noisy output', () => {
    const m = parseEnvelope('Sorry, I will just talk.', 'cli', { inputTokens: 0, outputTokens: 0 });
    expect(m.stop_reason).toBe('end_turn');
    expect(m.content[0]).toMatchObject({ text: 'Sorry, I will just talk.' });
    expect(extractJson('Here you go: {"a":1} done')).toEqual({ a: 1 });
    expect(extractJson('nope')).toBeUndefined();
  });
});

describe('CLI with no tools', () => {
  it('builds a valid envelope schema even for an empty tool list', () => {
    const items = (
      envelopeSchema([]) as {
        properties: { tool_calls: { items: { properties: { name: object } } } };
      }
    ).properties.tool_calls.items.properties.name;
    expect('enum' in items).toBe(false);
  });
});
