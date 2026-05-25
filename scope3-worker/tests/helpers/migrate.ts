import { applyD1Migrations } from 'cloudflare:test';
import { inject } from 'vitest';

export async function applyMigrations(db: D1Database): Promise<void> {
  const migrations = inject('migrations') as import('@cloudflare/vitest-pool-workers').D1Migration[];
  await applyD1Migrations(db, migrations);
}
