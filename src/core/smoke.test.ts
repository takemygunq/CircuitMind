import { describe, expect, it } from 'vitest';
import { z } from 'zod';

describe('toolchain', () => {
  it('runs vitest with zod', () => {
    expect(z.number().parse(1)).toBe(1);
  });
});
