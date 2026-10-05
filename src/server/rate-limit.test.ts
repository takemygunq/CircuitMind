import { describe, expect, it } from 'vitest';
import { RateLimiter } from './rate-limit';

describe('RateLimiter', () => {
  it('limits per key within the window and recovers', () => {
    const l = new RateLimiter(2, 1000);
    expect(l.take('a', 0)).toBe(true);
    expect(l.take('a', 10)).toBe(true);
    expect(l.take('a', 20)).toBe(false);
    expect(l.take('b', 20)).toBe(true);
    expect(l.take('a', 1500)).toBe(true);
  });
});
