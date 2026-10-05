import { expect, it } from 'vitest';
import { genericDraftGenerator } from './draft';

it('sends the board schema without $schema (Claude CLI rejects the draft 2020-12 reference)', async () => {
  let schema: Record<string, unknown> | undefined;
  const gen = genericDraftGenerator({
    client: {} as never,
    askJson: async (r) => {
      schema = r.schema as Record<string, unknown>;
      return '```json\n{"id":"x"}\n```';
    },
  });
  expect(await gen({ request: 'Pi 5', existingIds: [] })).toEqual({ id: 'x' });
  expect(schema).toBeDefined();
  expect('$schema' in schema!).toBe(false);
  expect(schema!.type).toBe('object');
});
