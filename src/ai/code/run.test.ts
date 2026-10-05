import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import {
  PIN_BLOCK_START,
  buildPinBindings,
  buildPreamble,
  composeFirmware,
  templateBody,
  templateFirmware,
} from '@/core/code';
import { blinkUno, weatherEsp32 } from '@/core/fixtures';
import { getBoard } from '@/core/library';
import type { Language } from '@/core/schema';
import { scriptedClient, textBlock, toolUse, type TurnScript } from '../agent/scripted';
import type { CodeEvent } from './events';
import { createMockCodeClient } from './mock';
import { runCodeAgent, splitFirmware, type CodeRequest } from './run';

const esp = getBoard('esp32-devkit-v1')!;
const uno = getBoard('arduino-uno')!;
const bindings = buildPinBindings(weatherEsp32, esp);
const goodBody = templateBody(weatherEsp32, esp, bindings, 'arduino');
const request = (over: Partial<CodeRequest> = {}): CodeRequest => ({
  mode: 'generate',
  project: weatherEsp32,
  board: esp,
  language: 'arduino',
  locale: 'ru',
  ...over,
});

function run(
  script: TurnScript[],
  req: CodeRequest = request(),
  extra: { maxRepairs?: number; signal?: AbortSignal } = {},
) {
  const client = scriptedClient(script);
  const events: CodeEvent[] = [];
  const promise = runCodeAgent({ client, request: req, emit: (e) => events.push(e), ...extra });
  return { client, events, promise };
}
const submit = (body: string, explanation = 'Делает X.', libraries: string[] = []) => ({
  content: [toolUse('submit_firmware', { body, explanation, libraries })],
});
const lastUser = (c: ReturnType<typeof scriptedClient>, i: number) =>
  c.requests[i].messages.at(-1)!.content as Anthropic.ToolResultBlockParam[];

describe('splitFirmware', () => {
  it('separates the pin block from the body', () => {
    const full = templateFirmware(weatherEsp32, esp, 'arduino');
    const { body, hasBlock } = splitFirmware(full);
    expect(hasBlock).toBe(true);
    expect(body).not.toContain(PIN_BLOCK_START);
    expect(body).toContain('void setup()');
    expect(composeFirmware(buildPreamble(bindings, 'arduino', esp), body)).toBe(full);
  });
  it('keeps code without a block as is', () => {
    expect(splitFirmware('int x;')).toEqual({ body: 'int x;', hasBlock: false });
  });
});

describe('generate', () => {
  it('prepends the generated pin block and accepts a clean body', async () => {
    const { promise, events, client } = run([
      submit(goodBody, 'Мигает светодиодом.', ['DHT sensor library']),
    ]);
    const r = await promise;
    expect(r).toMatchObject({
      ok: true,
      attempts: 1,
      mode: 'generate',
      language: 'arduino',
      libraries: ['DHT sensor library'],
      explanation: 'Мигает светодиодом.',
    });
    expect(r.code.startsWith('// ==== ' + PIN_BLOCK_START)).toBe(true);
    expect(r.code).toContain('constexpr auto LED = uint8_t(18);');
    expect(events.map((e) => e.type)).toEqual(['start', 'lint']);
    // модель получила карту пинов и язык
    const prompt = String(client.requests[0].messages[0].content);
    expect(prompt).toContain('Arduino C++');
    expect(prompt).toContain('"constant":"LED"');
    expect(prompt).toContain('Russian');
    expect(client.requests[0].tools.map((t) => t.name)).toEqual(['submit_firmware']);
  });

  it('strips a pin block the model repeats and never trusts its constants', async () => {
    const withBlock = `// ==== ${PIN_BLOCK_START} ====\nconstexpr auto LED = uint8_t(5);\n// ==== end of generated pins ====\n${goodBody}`;
    const r = await run([submit(withBlock)]).promise;
    expect(r.code).toContain('uint8_t(18)');
    expect(r.code).not.toContain('uint8_t(5)');
    expect(r.ok).toBe(true);
  });

  it('returns lint errors to the model and accepts the repaired code', async () => {
    const bad = goodBody + '\nvoid x() { pinMode(27, OUTPUT); }\n';
    const { promise, events, client } = run([submit(bad), submit(goodBody)]);
    const r = await promise;
    expect(r).toMatchObject({ ok: true, attempts: 2 });
    const feedback = lastUser(client, 1)[0];
    expect(feedback.is_error).toBe(true);
    expect(String(feedback.content)).toContain('Pin 27');
    expect(
      events
        .filter((e) => e.type === 'lint')
        .map((e) => (e as Extract<CodeEvent, { type: 'lint' }>).issues.length > 0),
    ).toEqual([true, false]);
    expect(events).toContainEqual({ type: 'repair', attempt: 1, max: 2 });
  });

  it('gives up after the repair budget and flags the result', async () => {
    const bad = goodBody + '\nvoid x() { pinMode(27, OUTPUT); }\n';
    const { promise, client } = run([submit(bad)]);
    const r = await promise;
    expect(r.ok).toBe(false);
    expect(r.attempts).toBe(3);
    expect(client.requests).toHaveLength(3);
    expect(r.issues.some((i) => i.code === 'pin_not_wired' && i.severity === 'error')).toBe(true);
    expect(r.code).toContain('pinMode(27, OUTPUT)'); // пользователь увидит код вместе с замечаниями
  });

  it('keeps warnings (hard-coded wired pins) without failing', async () => {
    const r = await run([submit(goodBody + '\nvoid y() { digitalWrite(18, HIGH); }\n')]).promise;
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([
      expect.objectContaining({
        severity: 'warning',
        code: 'raw_pin_literal',
        line: expect.any(Number),
      }),
    ]);
  });

  it('works for MicroPython and for the Uno', async () => {
    const mp = templateBody(weatherEsp32, esp, bindings, 'micropython');
    const r1 = await run([submit(mp)], request({ language: 'micropython' })).promise;
    expect(r1.ok).toBe(true);
    expect(r1.code).toContain('LED = 18');
    const unoBody = templateBody(blinkUno, uno, buildPinBindings(blinkUno, uno), 'arduino');
    const r2 = await run([submit(unoBody)], request({ project: blinkUno, board: uno })).promise;
    expect(r2.ok).toBe(true);
    expect(r2.code).toContain('uint8_t(13)');
  });

  it('handles bad tool input, truncation, and a missing tool call', async () => {
    const { promise, client } = run([
      { content: [toolUse('submit_firmware', { body: '' })] },
      { content: [toolUse('submit_firmware', { body: 'x' })], stopReason: 'max_tokens' },
      submit(goodBody),
    ]);
    expect((await promise).ok).toBe(true);
    expect(String(lastUser(client, 1)[0].content)).toContain('Invalid submit_firmware input');
    expect(String(lastUser(client, 2)[0].content)).toContain('cut off');
    const nudged = run([{ content: [textBlock('Sure!')] }, submit(goodBody)]);
    expect((await nudged.promise).ok).toBe(true);
    await expect(run([{ content: [textBlock('no')] }]).promise).rejects.toMatchObject({
      code: 'no_project',
    });
  });

  it('stops on refusal, token budget and abort', async () => {
    await expect(run([{ content: [], stopReason: 'refusal' }]).promise).rejects.toMatchObject({
      code: 'refused',
    });
    const hungry = scriptedClient([
      {
        content: [toolUse('submit_firmware', { body: goodBody, explanation: '', libraries: [] })],
        usage: { output: 100_000 },
      },
    ]);
    await expect(
      runCodeAgent({ client: hungry, request: request(), emit: () => {} }),
    ).rejects.toMatchObject({ code: 'budget_exceeded' });
    const ac = new AbortController();
    ac.abort();
    await expect(
      run([submit(goodBody)], request(), { signal: ac.signal }).promise,
    ).rejects.toThrow();
  });
});

describe('edit', () => {
  const current = templateFirmware(weatherEsp32, esp, 'arduino');
  it('sends the current body and instruction and keeps the pin block canonical', async () => {
    const newBody = goodBody.replace('1000', '5000');
    const { promise, client } = run(
      [submit(newBody, 'Интервал увеличен до 5 с.')],
      request({ mode: 'edit', code: current, instruction: 'Читать датчик раз в 5 секунд' }),
    );
    const r = await promise;
    expect(r).toMatchObject({ ok: true, mode: 'edit', explanation: 'Интервал увеличен до 5 с.' });
    expect(r.code).toContain('5000');
    const prompt = String(client.requests[0].messages[0].content);
    expect(prompt).toContain('Читать датчик раз в 5 секунд');
    expect(prompt).toContain('void setup()');
    expect(prompt).not.toContain('constexpr auto LED'); // блок пинов модели не показываем: он уже в файле
  });
  it('rebuilds the pin block even if the user deleted it', async () => {
    const stripped = splitFirmware(current).body;
    const r = await run(
      [submit(goodBody)],
      request({ mode: 'edit', code: stripped, instruction: 'сделай что-нибудь' }),
    ).promise;
    expect(r.code).toContain(PIN_BLOCK_START);
  });
  it('requires code and an instruction', async () => {
    await expect(
      run([submit(goodBody)], request({ mode: 'edit', instruction: 'x' })).promise,
    ).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(
      run([submit(goodBody)], request({ mode: 'edit', code: current })).promise,
    ).rejects.toMatchObject({ code: 'invalid_request' });
  });
});

describe('explain', () => {
  it('streams a plain-text explanation without tools', async () => {
    const { promise, client, events } = run(
      [{ content: [textBlock('Программа раз в секунду мигает светодиодом.')] }],
      request({
        mode: 'explain',
        code: templateFirmware(weatherEsp32, esp, 'arduino'),
        instruction: 'Что делает loop?',
      }),
    );
    const r = await promise;
    expect(r).toMatchObject({
      mode: 'explain',
      code: '',
      ok: true,
      explanation: 'Программа раз в секунду мигает светодиодом.',
    });
    expect(client.requests[0].tools).toEqual([]);
    expect(String(client.requests[0].messages[0].content)).toContain('Что делает loop?');
    expect(events).toContainEqual({
      type: 'text',
      delta: 'Программа раз в секунду мигает светодиодом.',
    });
  });
  it('needs code', async () => {
    await expect(
      run([{ content: [textBlock('x')] }], request({ mode: 'explain' })).promise,
    ).rejects.toMatchObject({ code: 'invalid_request' });
  });
});

describe('mock firmware client', () => {
  const langs: Language[] = ['arduino', 'micropython', 'esp-idf', 'circuitpython'];
  it.each(langs)('shows the repair loop for %s', async (language) => {
    const client = createMockCodeClient({
      project: weatherEsp32,
      board: esp,
      language,
      mode: 'generate',
    });
    const events: CodeEvent[] = [];
    const r = await runCodeAgent({
      client,
      request: request({ language }),
      emit: (e) => events.push(e),
    });
    expect(r).toMatchObject({ ok: true, attempts: 2, model: 'mock-model' });
    expect(events.filter((e) => e.type === 'lint').length).toBe(2);
    expect(events.some((e) => e.type === 'repair')).toBe(true);
  });
  it('edits and explains in demo mode', async () => {
    const current = templateFirmware(weatherEsp32, esp, 'arduino');
    const edit = await runCodeAgent({
      client: createMockCodeClient({
        project: weatherEsp32,
        board: esp,
        language: 'arduino',
        mode: 'edit',
        currentBody: splitFirmware(current).body,
        instruction: 'добавь кнопку',
      }),
      request: request({ mode: 'edit', code: current, instruction: 'добавь кнопку' }),
      emit: () => {},
    });
    expect(edit.code).toContain('[demo] добавь кнопку');
    const ex = await runCodeAgent({
      client: createMockCodeClient({
        project: weatherEsp32,
        board: esp,
        language: 'arduino',
        mode: 'explain',
      }),
      request: request({ mode: 'explain', code: current }),
      emit: () => {},
    });
    expect(ex.explanation).toContain('демо-объяснение');
  });
});
