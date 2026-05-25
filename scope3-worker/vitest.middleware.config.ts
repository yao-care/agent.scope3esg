import { defineConfig } from 'vitest/config';

// Separate config for middleware tests that run in standard Node.js (no Cloudflare Workers runtime)
export default defineConfig({
  test: {
    include: ['tests/middleware/**/*.test.ts', 'tests/github/**/*.test.ts', 'tests/tenant/**/*.test.ts'],
    environment: 'node',
  },
});
