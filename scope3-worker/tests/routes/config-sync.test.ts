import { describe, it, expect, vi, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import { applyMigrations } from '../helpers/migrate';
import { insertTenant } from '../../src/db/queries';
import { app } from '../../src/index';

vi.mock('../../src/handlers/config-push', () => ({
  syncConfig: vi.fn().mockResolvedValue(undefined),
  handleConfigPush: vi.fn().mockResolvedValue(undefined),
}));

describe('POST /api/v1/config-sync/:org', () => {
  beforeAll(async () => {
    await applyMigrations(env.DB);
    await insertTenant(env.DB, { installationId: 777, org: 'sync-org', repoNodeId: 'R_y' });
  });

  it('returns 200 and calls syncConfig for a known org', async () => {
    const { syncConfig } = await import('../../src/handlers/config-push');
    const res = await app.request('/api/v1/config-sync/sync-org', { method: 'POST' }, env as any);
    expect(res.status).toBe(200);
    expect(syncConfig).toHaveBeenCalledWith(expect.anything(), 'sync-org', 777);
  });

  it('returns 404 for unknown org', async () => {
    const res = await app.request('/api/v1/config-sync/ghost-org', { method: 'POST' }, env as any);
    expect(res.status).toBe(404);
  });
});
