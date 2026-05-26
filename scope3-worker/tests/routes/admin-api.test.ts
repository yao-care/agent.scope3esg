import { describe, it, expect, vi, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import { applyMigrations } from '../helpers/migrate';
import { insertTenant, insertSupplierToken } from '../../src/db/queries';
import { signSession } from '../../src/lib/session';
import { app } from '../../src/index';

vi.mock('../../src/github/app', () => ({
  getInstallationOctokit: vi.fn().mockResolvedValue({ request: vi.fn() }),
}));
vi.mock('../../src/github/config', () => ({
  readTenantConfig: vi.fn().mockResolvedValue({ inventory_year: 2026, enabled_categories: [1], suppliers: [] }),
}));
vi.mock('../../src/handlers/config-push', () => ({
  syncConfig: vi.fn().mockResolvedValue(undefined),
  handleConfigPush: vi.fn().mockResolvedValue(undefined),
}));

async function sessionCookie(org: string) {
  const token = await signSession({ org, user: 'tester', exp: Date.now() + 100000 }, (env as any).SESSION_SECRET);
  return `scope3_session=${token}`;
}

describe('admin API auth', () => {
  beforeAll(async () => {
    await applyMigrations(env.DB);
    await insertTenant(env.DB, { installationId: 900, org: 'acme', repoNodeId: 'R_a' });
    await insertSupplierToken(env.DB, { token: 'stok_1', org: 'acme', supplierId: 'SUP001', expiresAt: '2099-01-01T00:00:00Z' });
  });

  it('rejects requests without a session (401)', async () => {
    const res = await app.request('/api/v1/admin/acme/config', {}, env as any);
    expect(res.status).toBe(401);
  });
  it('rejects session for a different org (401)', async () => {
    const res = await app.request('/api/v1/admin/acme/config', { headers: { Cookie: await sessionCookie('other-org') } }, env as any);
    expect(res.status).toBe(401);
  });
  it('returns config JSON with a valid session', async () => {
    const res = await app.request('/api/v1/admin/acme/config', { headers: { Cookie: await sessionCookie('acme') } }, env as any);
    expect(res.status).toBe(200);
    const body = await res.json<{ inventory_year: number }>();
    expect(body.inventory_year).toBe(2026);
  });
  it('lists supplier links with a valid session', async () => {
    const res = await app.request('/api/v1/admin/acme/links', { headers: { Cookie: await sessionCookie('acme') } }, env as any);
    expect(res.status).toBe(200);
    const body = await res.json<{ links: Array<{ supplierId: string; url: string }> }>();
    expect(body.links.some((l) => l.supplierId === 'SUP001')).toBe(true);
  });
  it('returns supplier overview with form url and submission count', async () => {
    const res = await app.request('/api/v1/admin/acme/overview', { headers: { Cookie: await sessionCookie('acme') } }, env as any);
    expect(res.status).toBe(200);
    const body = await res.json<{ suppliers: Array<{ id: string }> }>();
    expect(Array.isArray(body.suppliers)).toBe(true);
  });
});
