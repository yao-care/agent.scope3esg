import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { tenants } from './schema';

interface TenantInput {
  installationId: number;
  org: string;
  repoNodeId?: string;
}

export async function insertTenant(db: D1Database, input: TenantInput): Promise<void> {
  const client = drizzle(db);
  await client.insert(tenants).values({
    installationId: input.installationId,
    org:            input.org,
    repoNodeId:     input.repoNodeId ?? null,
    createdAt:      new Date().toISOString(),
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
