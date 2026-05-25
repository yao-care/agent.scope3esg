import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import { applyMigrations } from '../helpers/migrate';
import { insertTenant, getTenant } from '../../src/db/queries';

describe('insertTenant / getTenant', () => {
  beforeAll(async () => {
    await applyMigrations(env.DB);
  });

  it('inserts and retrieves a tenant by installationId', async () => {
    await insertTenant(env.DB, { installationId: 1, org: 'test-org', repoNodeId: 'R_123' });
    const tenant = await getTenant(env.DB, 1);
    expect(tenant?.org).toBe('test-org');
    expect(tenant?.repoNodeId).toBe('R_123');
  });
});
