import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import path from 'path';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        d1Databases: ['DB'],
        // 測試專用 binding；production 不設 RESEND_API_KEY（未設則略過寄信）。
        bindings: { RESEND_API_KEY: 'test_re_key' },
      },
    }),
  ],
  test: {
    globalSetup: './tests/helpers/global-setup.ts',
    include: ['tests/db/**/*.test.ts', 'tests/handlers/**/*.test.ts', 'tests/routes/**/*.test.ts'],
  },
});
