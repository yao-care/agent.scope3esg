import { describe, it, expect, beforeAll, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { applyMigrations } from '../helpers/migrate';
import { upsertPullJob, insertSupplierToken } from '../../src/db/queries';
import { handleScheduled } from '../../src/handlers/scheduled';

describe('handleScheduled', () => {
  beforeAll(async () => {
    await applyMigrations(env.DB);
    await insertSupplierToken(env.DB, { token: 'stok_pull', org: 'pull-org', supplierId: 'SUP9', expiresAt: '2099-01-01T00:00:00Z' });
    await upsertPullJob(env.DB, { jobId: 'pull-org:SUP9', org: 'pull-org', supplierId: 'SUP9', apiUrl: 'https://api.x/esg', schedule: '0 1 * * *' });
  });

  it('enqueues a message for each pull job that has a supplier token', async () => {
    const fakeEnv = { ...env, SUBMISSION_QUEUE: { send: vi.fn().mockResolvedValue(undefined) } };
    await handleScheduled(fakeEnv as any);
    const calls = fakeEnv.SUBMISSION_QUEUE.send.mock.calls.filter((c) => c[0]?.supplier_id === 'SUP9');
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls[0][0].api_url).toBe('https://api.x/esg');
    expect(calls[0][0].token).toBe('stok_pull');
  });
});
