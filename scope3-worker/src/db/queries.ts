import { drizzle } from 'drizzle-orm/d1';
import { eq, and, notInArray } from 'drizzle-orm';
import { tenants, supplierTokens, pullJobs, auditLog } from './schema';

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

interface PullJobInput {
  jobId:      string;
  org:        string;
  supplierId: string;
  apiUrl:     string;
  schedule:   string;
  // 供應商自己的 API 憑證（呼叫其 ESG API 的 Bearer），與 supplier token 不同
  apiToken:   string | null;
}

export async function upsertPullJob(db: D1Database, input: PullJobInput): Promise<void> {
  const client = drizzle(db);
  await client
    .insert(pullJobs)
    .values({ jobId: input.jobId, org: input.org, supplierId: input.supplierId, apiUrl: input.apiUrl, schedule: input.schedule, lastRunAt: null, apiToken: input.apiToken })
    .onConflictDoUpdate({
      target: pullJobs.jobId,
      set: { org: input.org, supplierId: input.supplierId, apiUrl: input.apiUrl, schedule: input.schedule, apiToken: input.apiToken },
    });
}

export async function listAllPullJobs(db: D1Database) {
  const client = drizzle(db);
  return client.select().from(pullJobs);
}

export async function touchPullJobLastRun(db: D1Database, jobId: string): Promise<void> {
  const client = drizzle(db);
  await client.update(pullJobs).set({ lastRunAt: new Date().toISOString() }).where(eq(pullJobs.jobId, jobId));
}

interface AuditLogInput {
  org:    string;
  action: string;
  actor:  string;
  target: string;
}

export async function insertAuditLog(db: D1Database, input: AuditLogInput): Promise<void> {
  const client = drizzle(db);
  await client.insert(auditLog).values({
    id:        crypto.randomUUID(),
    org:       input.org,
    action:    input.action,
    actor:     input.actor,
    target:    input.target,
    createdAt: new Date().toISOString(),
  });
}

export async function listAuditLogByOrg(db: D1Database, org: string) {
  const client = drizzle(db);
  return client.select().from(auditLog).where(eq(auditLog.org, org));
}

export async function deleteSupplierTokensNotIn(db: D1Database, org: string, keepSupplierIds: string[]): Promise<void> {
  const client = drizzle(db);
  if (keepSupplierIds.length === 0) {
    await client.delete(supplierTokens).where(eq(supplierTokens.org, org));
    return;
  }
  await client.delete(supplierTokens).where(
    and(eq(supplierTokens.org, org), notInArray(supplierTokens.supplierId, keepSupplierIds)),
  );
}

export async function deletePullJobsNotIn(db: D1Database, org: string, keepSupplierIds: string[]): Promise<void> {
  const client = drizzle(db);
  if (keepSupplierIds.length === 0) {
    await client.delete(pullJobs).where(eq(pullJobs.org, org));
    return;
  }
  await client.delete(pullJobs).where(
    and(eq(pullJobs.org, org), notInArray(pullJobs.supplierId, keepSupplierIds)),
  );
}
