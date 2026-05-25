import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out:    './migrations',
  driver: 'd1-http',
});
