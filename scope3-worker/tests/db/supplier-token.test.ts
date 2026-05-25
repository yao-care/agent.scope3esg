// tests/db/supplier-token.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import { applyMigrations } from '../helpers/migrate';
import { insertSupplierToken, getSupplierToken, listSupplierTokensByOrg } from '../../src/db/queries';

describe('supplier token queries', () => {
  beforeAll(async () => {
    await applyMigrations(env.DB);
  });

  it('inserts and retrieves a supplier token', async () => {
    await insertSupplierToken(env.DB, {
      token:      'tok_abc123',
      org:        'acme-corp',
      supplierId: 'SUP001',
      expiresAt:  '2027-01-01T00:00:00Z',
    });
    const row = await getSupplierToken(env.DB, 'tok_abc123');
    expect(row?.org).toBe('acme-corp');
    expect(row?.supplierId).toBe('SUP001');
  });

  it('returns null for unknown token', async () => {
    const row = await getSupplierToken(env.DB, 'unknown');
    expect(row).toBeNull();
  });

  it('lists tokens by org', async () => {
    await insertSupplierToken(env.DB, {
      token:      'tok_xyz999',
      org:        'acme-corp',
      supplierId: 'SUP002',
      expiresAt:  '2027-01-01T00:00:00Z',
    });
    const rows = await listSupplierTokensByOrg(env.DB, 'acme-corp');
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.map(r => r.supplierId)).toContain('SUP001');
    expect(rows.map(r => r.supplierId)).toContain('SUP002');
  });
});
