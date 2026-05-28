import { Hono } from 'hono';
import type { Bindings, Variables } from '../types';
import { getTenantByOrg } from '../db/queries';
import { syncConfig } from '../handlers/config-push';

const configSync = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// 由租戶 repo 的 config-sync.yml Action 呼叫；冪等地為 config.yml 的供應商產 token。
configSync.post('/:org', async (c) => {
  const { org } = c.req.param();
  const tenant = await getTenantByOrg(c.env.DB, org);
  if (!tenant) {
    return c.json({ error: '找不到組織或應用程式尚未安裝' }, 404);
  }
  await syncConfig(c.env, org, tenant.installationId);
  return c.json({ ok: true });
});

export default configSync;
