import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Unit tests only; browser tests live in e2e/ and run with Playwright.
    include: ['src/**/*.test.ts'],
  },
});
