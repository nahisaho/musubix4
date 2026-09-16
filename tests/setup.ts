import { expect } from 'vitest';

declare module 'vitest' {
  interface Assertion<T = any> {
    toHaveSize(expected: number): T;
  }
}

expect.extend({
  toHaveSize(received: unknown, expected: number) {
    const size = received && typeof received === 'object' && 'size' in received
      ? (received as { size: unknown }).size
      : undefined;
    return {
      pass: size === expected,
      message: () => `expected collection size ${String(size)} to be ${expected}`,
    };
  },
});
