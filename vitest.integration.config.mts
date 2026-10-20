import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Tests against the running local stack (npm run db:start + npm run dispatch:setup), e.g. the
// notification dispatcher Edge Function. Run with: npm run test:integration
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['tests/integration/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    // Generous: the first call after a stack restart warms up the Edge Runtime.
    hookTimeout: 180_000,
  },
});
