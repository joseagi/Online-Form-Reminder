import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Same "@/..." import alias as tsconfig.json.
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    // Unit tests only; browser tests live in e2e/ and run with Playwright.
    include: ['src/**/*.test.ts'],
  },
});
