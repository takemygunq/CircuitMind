import { z } from 'zod';
import { CLI_KINDS, KEYLESS_KINDS, PROVIDER_KINDS } from '@/ai/providers/types';
import { handle } from '@/server/providers/http';
import { getActive, listProviders, createProvider } from '@/server/providers/store';

const Create = z
  .object({
    kind: z.enum(PROVIDER_KINDS),
    label: z.string().trim().min(1).max(60),
    apiKey: z.string().trim().max(500).default(''),
    // адрес API (прокси, Ollama) или путь к программе для CLI-мостов
    baseUrl: z.string().trim().max(500).optional(),
  })
  .refine((v) => KEYLESS_KINDS.includes(v.kind) || v.apiKey.length > 0, {
    message: 'API key required',
    path: ['apiKey'],
  })
  // путь к программе — строка без управляющих символов и пробелов-аргументов (запуск без shell, но без сюрпризов)
  .refine((v) => !CLI_KINDS.includes(v.kind) || !v.baseUrl || /^[^\s\0]+$/.test(v.baseUrl), {
    message: 'Invalid program path',
    path: ['baseUrl'],
  });

export const GET = (req: Request) =>
  handle(req, () => ({ providers: listProviders(), active: getActive() }));

export const POST = (req: Request) =>
  handle(req, async () => ({ provider: createProvider(Create.parse(await req.json())) }));
