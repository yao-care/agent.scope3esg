import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import { applyMigrations } from '../helpers/migrate';
import { insertSupplierToken, listSupplierTokensByOrg, deleteSupplierTokensNotIn } from '../../src/db/queries';

describe('deleteSupplierTokensNotIn', () => {
  beforeAll(async () => {
    await applyMigrations(env.DB);
    await insertSupplierToken(env.DB, { token: 'tk_keep', org: 'rec-org', supplierId: 'KEEP1', expiresAt: '2099-01-01T00:00:00Z' });
    await insertSupplierToken(env.DB, { token: 'tk_drop', org: 'rec-org', supplierId: 'DROP1', expiresAt: '2099-01-01T00:00:00Z' });
  });

  it('deletes tokens whose supplier_id is not in the keep list', async () => {
    await deleteSupplierTokensNotIn(env.DB, 'rec-org', ['KEEP1']);
    const rows = await listSupplierTokensByOrg(env.DB, 'rec-org');
    const ids = rows.map((r) => r.supplierId);
    expect(ids).toContain('KEEP1');
    expect(ids).not.toContain('DROP1');
  });

  it('deletes all when keep list is empty', async () => {
    await insertSupplierToken(env.DB, { token: 'tk_x', org: 'empty-org', supplierId: 'X1', expiresAt: '2099-01-01T00:00:00Z' });
    await deleteSupplierTokensNotIn(env.DB, 'empty-org', []);
    const rows = await listSupplierTokensByOrg(env.DB, 'empty-org');
    expect(rows.length).toBe(0);
  });

  it('does not touch other orgs', async () => {
    await insertSupplierToken(env.DB, { token: 'tk_other', org: 'other-org', supplierId: 'O1', expiresAt: '2099-01-01T00:00:00Z' });
    await deleteSupplierTokensNotIn(env.DB, 'rec-org', []);
    const rows = await listSupplierTokensByOrg(env.DB, 'other-org');
    expect(rows.length).toBe(1);
  });
});
