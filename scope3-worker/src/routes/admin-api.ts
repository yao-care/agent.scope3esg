// src/routes/admin-api.ts
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { Bindings, Variables, TenantConfig } from '../types';
import { verifySession } from '../lib/session';
import { getTenantByOrg, listSupplierTokensByOrg } from '../db/queries';
import { getInstallationOctokit } from '../github/app';
import { readTenantConfig } from '../github/config';
import { syncConfig } from '../handlers/config-push';
import { configToYaml } from '../lib/config-yaml';
import { generateFormUrl } from '../lib/tokens';

const adminApi = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function readCookie(cookieHeader: string, name: string): string | null {
  for (const part of cookieHeader.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

const requireSession = createMiddleware<{ Bindings: Bindings; Variables: Variables }>(async (c, next) => {
  const org = c.req.param('org');
  const cookie = readCookie(c.req.header('Cookie') ?? '', 'scope3_session');
  const session = cookie ? await verifySession(cookie, c.env.SESSION_SECRET) : null;
  if (!session || session.org !== org) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  await next();
});

adminApi.use('/:org/*', requireSession);

adminApi.get('/:org/config', async (c) => {
  const { org } = c.req.param();
  const tenant = await getTenantByOrg(c.env.DB, org);
  if (!tenant) return c.json({ error: 'unknown org' }, 404);
  const octokit = await getInstallationOctokit(c.env, tenant.installationId);
  const config = await readTenantConfig(octokit, org);
  return c.json(config ?? { inventory_year: new Date().getFullYear(), enabled_categories: [], suppliers: [] });
});

adminApi.put('/:org/config', async (c) => {
  const { org } = c.req.param();
  const tenant = await getTenantByOrg(c.env.DB, org);
  if (!tenant) return c.json({ error: 'unknown org' }, 404);
  const incoming = await c.req.json<TenantConfig>();
  const yaml = configToYaml(incoming);

  const octokit = await getInstallationOctokit(c.env, tenant.installationId);
  let sha: string | undefined;
  try {
    const res = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', { owner: org, repo: 'scope3-inventory', path: 'config.yml' });
    const data = res?.data as { sha?: string } | undefined;
    if (data && typeof data.sha === 'string') sha = data.sha;
  } catch { /* 不存在則建立 */ }

  await octokit.request('PUT /repos/{owner}/{repo}/contents/{path}', {
    owner: org, repo: 'scope3-inventory', path: 'config.yml',
    message: 'chore: update config.yml via admin UI',
    content: btoa(unescape(encodeURIComponent(yaml))),
    ...(sha ? { sha } : {}),
  });

  await syncConfig(c.env, org, tenant.installationId);
  return c.json({ ok: true });
});

adminApi.get('/:org/links', async (c) => {
  const { org } = c.req.param();
  const tokens = await listSupplierTokensByOrg(c.env.DB, org);
  const links = tokens.map((t) => ({ supplierId: t.supplierId, url: generateFormUrl(c.env.WORKER_BASE_URL, org, t.token) }));
  return c.json({ links });
});

adminApi.get('/:org/submissions', async (c) => {
  const { org } = c.req.param();
  const tenant = await getTenantByOrg(c.env.DB, org);
  if (!tenant) return c.json({ error: 'unknown org' }, 404);
  const octokit = await getInstallationOctokit(c.env, tenant.installationId);
  const { data: issues } = await octokit.request('GET /repos/{owner}/{repo}/issues', { owner: org, repo: 'scope3-inventory', state: 'all', per_page: 100 });
  const items = (issues as Array<{ number: number; title: string; labels: Array<{ name: string }> }>).map((i) => ({
    number: i.number,
    title: i.title,
    status: (i.labels.map((l) => l.name).find((n) => n.startsWith('status:')) ?? 'status:submitted').replace('status:', ''),
  }));
  return c.json({ submissions: items });
});

adminApi.get('/:org/overview', async (c) => {
  const { org } = c.req.param();
  const tenant = await getTenantByOrg(c.env.DB, org);
  if (!tenant) return c.json({ error: 'unknown org' }, 404);
  const octokit = await getInstallationOctokit(c.env, tenant.installationId);
  const config = await readTenantConfig(octokit, org) ?? { inventory_year: new Date().getFullYear(), enabled_categories: [], suppliers: [] };

  // token → formUrl by supplierId
  const tokens = await listSupplierTokensByOrg(c.env.DB, org);
  const urlBySupplier: Record<string, string> = {};
  for (const t of tokens) urlBySupplier[t.supplierId] = generateFormUrl(c.env.WORKER_BASE_URL, org, t.token);

  // 提交數 by supplierId（解析 issue body 的 scope3-data）
  const countBySupplier: Record<string, number> = {};
  try {
    const { data: issues } = await octokit.request('GET /repos/{owner}/{repo}/issues', {
      owner: org, repo: 'scope3-inventory', state: 'all', per_page: 100,
    });
    for (const issue of issues as Array<{ body?: string }>) {
      const m = issue.body && issue.body.match(/<!-- scope3-data:\n([\s\S]*?)\n-->/);
      if (!m) continue;
      try {
        const d = JSON.parse(m[1]);
        if (d.supplier_id) countBySupplier[d.supplier_id] = (countBySupplier[d.supplier_id] || 0) + 1;
      } catch { /* skip */ }
    }
  } catch { /* repo issues unreadable */ }

  const suppliers = (config.suppliers || []).map((s) => ({
    ...s,
    formUrl: urlBySupplier[s.id] || null,
    submissionCount: countBySupplier[s.id] || 0,
  }));

  return c.json({ inventory_year: config.inventory_year, enabled_categories: config.enabled_categories, suppliers });
});

export default adminApi;
