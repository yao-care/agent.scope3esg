import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { tenants, supplierTokens } from './schema';

interface TenantInput {
  installationId: number;
  org: string;
  repoNodeId?: string;
}

export async function insertTenant(db: D1Database, input: TenantInput): Promise<void> {
  const client = drizzle(db);
  await client
    .insert(tenants)
    .values({
      installationId: input.installationId,
      org:            input.org,
      repoNodeId:     input.repoNodeId ?? null,
      createdAt:      new Date().toISOString(),
    })
    // 重複安裝 / webhook 重送時冪等：以 installation_id 為鍵更新 org 與 repo_node_id，保留原 created_at
    .onConflictDoUpdate({
      target: tenants.installationId,
      set: {
        org:        input.org,
        repoNodeId: input.repoNodeId ?? null,
      },
    });
}

export async function getTenant(db: D1Database, installationId: number) {
  const client = drizzle(db);
  const rows = await client
    .select()
    .from(tenants)
    .where(eq(tenants.installationId, installationId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getTenantByOrg(db: D1Database, org: string) {
  const client = drizzle(db);
  const rows = await client
    .select()
    .from(tenants)
    .where(eq(tenants.org, org))
    .limit(1);
  return rows[0] ?? null;
}

interface SupplierTokenInput {
  token:      string;
  org:        string;
  supplierId: string;
  expiresAt:  string;
}

export async function insertSupplierToken(db: D1Database, input: SupplierTokenInput): Promise<void> {
  const client = drizzle(db);
  await client.insert(supplierTokens).values({
    token:      input.token,
    org:        input.org,
    supplierId: input.supplierId,
    expiresAt:  input.expiresAt,
    createdAt:  new Date().toISOString(),
  });
}

export async function getSupplierToken(db: D1Database, token: string) {
  const client = drizzle(db);
  const rows = await client
    .select()
    .from(supplierTokens)
    .where(eq(supplierTokens.token, token))
    .limit(1);
  return rows[0] ?? null;
}

export async function listSupplierTokensByOrg(db: D1Database, org: string) {
  const client = drizzle(db);
  return client
    .select()
    .from(supplierTokens)
    .where(eq(supplierTokens.org, org));
}
