// src/routes/admin.ts
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Bindings, Variables } from '../types';
import { signSession, signState, verifyState, verifySession } from '../lib/session';
import { adminPageHtml } from '../admin/page';
import { reviewPageHtml } from '../admin/review-page';
import { reportsPageHtml } from '../admin/reports-page';
import { getTenantByOrg } from '../db/queries';
import { getInstallationOctokit } from '../github/app';

const admin = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const SESSION_COOKIE = 'scope3_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

function sessionCookie(value: string): string {
  return `${SESSION_COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`;
}

function readCookie(c: { req: { header: (n: string) => string | undefined } }, name: string): string | null {
  const raw = c.req.header('Cookie') ?? '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

// GitHub OAuth 回呼處理。抽成函式，讓 /callback 與「被 /:org 攔截的 callback」都能正確處理。
async function handleOAuthCallback(c: Context<{ Bindings: Bindings; Variables: Variables }>) {
  const code = c.req.query('code');
  const state = c.req.query('state');
  if (!code || !state) return c.text('缺少授權參數，請重新登入', 400);

  const statePayload = await verifyState(state, c.env.SESSION_SECRET);
  if (!statePayload) return c.text('登入驗證失敗，請重新登入', 400);
  const org = statePayload.org;

  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: c.env.GITHUB_APP_CLIENT_ID, client_secret: c.env.GITHUB_APP_CLIENT_SECRET, code }),
  });
  const tokenJson = await tokenRes.json<{ access_token?: string }>();
  const userToken = tokenJson.access_token;
  if (!userToken) return c.text('GitHub 授權失敗，請重新登入', 401);

  const userRes = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${userToken}`, 'User-Agent': 'scope3-app', Accept: 'application/vnd.github+json' },
  });
  const user = await userRes.json<{ login?: string }>();
  if (!user.login) return c.text('無法讀取使用者資訊', 401);

  // 用 installation token（App 有 members:read）確認使用者為該 org 成員。
  // GET /orgs/{org}/members/{username}：204=成員、404=非成員（octokit 對 404 會 throw）。
  const tenant = await getTenantByOrg(c.env.DB, org);
  if (!tenant) return c.text('此組織尚未啟用 Scope3 服務', 404);
  const octokit = await getInstallationOctokit(c.env, tenant.installationId);
  try {
    await octokit.request('GET /orgs/{org}/members/{username}', { org, username: user.login });
  } catch {
    return c.text('您不是此組織的成員，無法登入', 403);
  }

  const token = await signSession({ org, user: user.login, exp: Date.now() + SESSION_TTL_MS }, c.env.SESSION_SECRET);
  c.header('Set-Cookie', sessionCookie(token));
  return c.redirect(`/admin/${org}`);
}

admin.get('/callback', (c) => handleOAuthCallback(c));

admin.get('/:org', async (c) => {
  const { org } = c.req.param();
  // /admin/callback 可能被本參數路由攔截（callback 被當成 :org），偵測到就轉交 OAuth 回呼處理。
  if (org === 'callback') return handleOAuthCallback(c);
  const cookie = readCookie(c, SESSION_COOKIE);
  const session = cookie ? await verifySession(cookie, c.env.SESSION_SECRET) : null;
  if (!session || session.org !== org) {
    return c.redirect(`/admin/${org}/login`);
  }
  return c.html(adminPageHtml(org));
});

admin.get('/:org/review', async (c) => {
  const { org } = c.req.param();
  const cookie = readCookie(c, SESSION_COOKIE);
  const session = cookie ? await verifySession(cookie, c.env.SESSION_SECRET) : null;
  if (!session || session.org !== org) {
    return c.redirect(`/admin/${org}/login`);
  }
  return c.html(reviewPageHtml(org));
});

admin.get('/:org/reports', async (c) => {
  const { org } = c.req.param();
  const cookie = readCookie(c, SESSION_COOKIE);
  const session = cookie ? await verifySession(cookie, c.env.SESSION_SECRET) : null;
  if (!session || session.org !== org) {
    return c.redirect(`/admin/${org}/login`);
  }
  return c.html(reportsPageHtml(org));
});

admin.get('/:org/login', async (c) => {
  const { org } = c.req.param();
  // /admin/callback/login 等同 callback 被攔截後又被導去 login，避免簽出 org=callback 的 state。
  if (org === 'callback') return handleOAuthCallback(c);
  const nonce = crypto.randomUUID();
  const state = await signState({ org, nonce }, c.env.SESSION_SECRET);
  const redirectUri = `${c.env.WORKER_BASE_URL}/admin/callback`;
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', c.env.GITHUB_APP_CLIENT_ID);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  return c.redirect(url.toString());
});

admin.post('/:org/logout', async (c) => {
  c.header('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
  return c.json({ ok: true });
});

export default admin;
