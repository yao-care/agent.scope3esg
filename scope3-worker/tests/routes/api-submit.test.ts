import { describe, it, expect, vi, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import { applyMigrations } from '../helpers/migrate';
import { insertSupplierToken } from '../../src/db/queries';
import { app } from '../../src/index';

vi.mock('../../src/handlers/submission', () => ({
  processSubmission: vi.fn().mockResolvedValue({ success: true, prNumber: 7 }),
}));

describe('POST /api/v1/submit', () => {
  beforeAll(async () => {
    await applyMigrations(env.DB);
    await insertSupplierToken(env.DB, {
      token:      'stok_apitest',
      org:        'acme-corp',
      supplierId: 'SUP001',
      expiresAt:  '2099-01-01T00:00:00Z',
    });
  });

  it('returns 201 with PR number on valid request', async () => {
    const res = await app.request('/api/v1/submit', {
      method:  'POST',
      headers: {
        'Authorization': 'Bearer stok_apitest',
        'Content-Type':  'application/json',
        'X-Scope3-Org':  'acme-corp',
      },
      body: JSON.stringify({
        scope3_category: 1,
        period:          '2025-Q1',
        activity_type:   'electricity',
        amount:          5000,
        unit:            'kWh',
        evidence_urls:   [],
      }),
    }, env as any);

    expect(res.status).toBe(201);
    const body = await res.json<{ prNumber: number }>();
    expect(body.prNumber).toBe(7);
  });

  it('returns 401 when Authorization header is missing', async () => {
    const res = await app.request('/api/v1/submit', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-Scope3-Org': 'acme-corp' },
      body:    JSON.stringify({ scope3_category: 1, period: '2025-Q1', activity_type: 'x', amount: 1, unit: 'kg', evidence_urls: [] }),
    }, env as any);
    expect(res.status).toBe(401);
  });
});
