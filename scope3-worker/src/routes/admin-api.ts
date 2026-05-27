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
import { aggregateKpis } from '../lib/aggregate';
import { listOpenPullRequestsByPrefix } from '../github/pr';

const adminApi = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// 讀取 main 上 data/submissions.json（calculate workflow 產生的已核定提交彙整）。
// 用 atob + TextDecoder 解 base64/UTF-8（不可直接把 atob 結果當字串，會壞中文）。
async function readAggregatedSubmissions(octokit: Awaited<ReturnType<typeof getInstallationOctokit>>, org: string): Promise<any[]> {
  try {
    const res = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', { owner: org, repo: 'scope3-inventory', path: 'data/submissions.json' });
    const data = res?.data as { content?: string } | undefined;
    if (!data?.content) return [];
    const bytes = Uint8Array.from(atob(data.content.replace(/\n/g, '')), (ch) => ch.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder('utf-8').decode(bytes));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

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

  // 待審來自 open PR（分支 sub/{supplierId}/{submissionId}）
  const prs = await listOpenPullRequestsByPrefix(octokit, org, 'sub/');
  const pending = prs.map((p) => ({ number: p.number, title: p.title, status: 'pending' }));

  // 已核定來自 calculate workflow 彙整的 data/submissions.json
  const aggregated = await readAggregatedSubmissions(octokit, org);
  const approved = aggregated.map((s: any) => ({
    title: `${s.supplier_id} Cat.${s.scope3_category} ${s.period} ${s.activity_type} (${s.calculated_co2e} kgCO2e)`,
    status: 'approved',
  }));

  return c.json({ submissions: [...pending, ...approved] });
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

  // 提交數 by supplierId：已核定（彙整檔）+ 待審（open PR，分支 sub/{supplierId}/...）
  const countBySupplier: Record<string, number> = {};
  const aggregated = await readAggregatedSubmissions(octokit, org);
  for (const s of aggregated as Array<{ supplier_id?: string }>) {
    if (s.supplier_id) countBySupplier[s.supplier_id] = (countBySupplier[s.supplier_id] || 0) + 1;
  }
  const openPrs = await listOpenPullRequestsByPrefix(octokit, org, 'sub/');
  for (const p of openPrs) {
    const sid = p.head.ref.split('/')[1]; // sub/{supplierId}/{submissionId}
    if (sid) countBySupplier[sid] = (countBySupplier[sid] || 0) + 1;
  }

  const suppliers = (config.suppliers || []).map((s) => ({
    ...s,
    formUrl: urlBySupplier[s.id] || null,
    submissionCount: countBySupplier[s.id] || 0,
  }));

  return c.json({ inventory_year: config.inventory_year, enabled_categories: config.enabled_categories, suppliers });
});

adminApi.get('/:org/review/count', async (c) => {
  const { org } = c.req.param();
  const tenant = await getTenantByOrg(c.env.DB, org);
  if (!tenant) return c.json({ pending: 0 });
  try {
    const octokit = await getInstallationOctokit(c.env, tenant.installationId);
    const sub = await listOpenPullRequestsByPrefix(octokit, org, 'sub/');
    const wd = await listOpenPullRequestsByPrefix(octokit, org, 'withdraw/');
    return c.json({ pending: sub.length + wd.length });
  } catch {
    return c.json({ pending: 0 });
  }
});

adminApi.get('/:org/dashboard-data', async (c) => {
  const { org } = c.req.param();
  const tenant = await getTenantByOrg(c.env.DB, org);
  if (!tenant) return c.json({ error: 'unknown org' }, 404);
  const octokit = await getInstallationOctokit(c.env, tenant.installationId);
  const submissions = await readAggregatedSubmissions(octokit, org);
  return c.json(aggregateKpis(submissions));
});

export default adminApi;
