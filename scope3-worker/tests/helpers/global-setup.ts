import { readD1Migrations } from '@cloudflare/vitest-pool-workers';
import path from 'path';

export async function setup({ provide }: { provide: (key: string, value: unknown) => void }) {
  const migrationsPath = path.resolve(__dirname, '../../migrations');
  const migrations = await readD1Migrations(migrationsPath);
  provide('migrations', migrations);
}
