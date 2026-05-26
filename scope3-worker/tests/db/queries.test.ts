import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import { applyMigrations } from '../helpers/migrate';
import { insertTenant, getTenant, getTenantByOrg } from '../../src/db/queries';

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

describe('getTenantByOrg', () => {
  it('returns tenant by org', async () => {
    await insertTenant(env.DB, { installationId: 555, org: 'find-me-org', repoNodeId: 'R_x' });
    const t = await getTenantByOrg(env.DB, 'find-me-org');
    expect(t?.installationId).toBe(555);
  });
  it('returns null for unknown org', async () => {
    expect(await getTenantByOrg(env.DB, 'nope-org')).toBeNull();
  });
});
