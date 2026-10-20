import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Same "@/..." import alias as tsconfig.json.
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    // Unit tests only: the app's helpers and the Edge Functions' pure modules. Browser tests live
    // in e2e/ (Playwright); tests against the running local stack live in tests/integration/.
    include: ['src/**/*.test.ts', 'supabase/functions/**/*.test.ts'],
  },
});
