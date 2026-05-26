// src/routes/admin.ts
import { Hono } from 'hono';
import type { Bindings, Variables } from '../types';
import { signSession, signState, verifyState, verifySession } from '../lib/session';
import { adminPageHtml } from '../admin/page';

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

admin.get('/:org', async (c) => {
  const { org } = c.req.param();
  const cookie = readCookie(c, SESSION_COOKIE);
  const session = cookie ? await verifySession(cookie, c.env.SESSION_SECRET) : null;
  if (!session || session.org !== org) {
    return c.redirect(`/admin/${org}/login`);
  }
  return c.html(adminPageHtml(org));
});

admin.get('/:org/login', async (c) => {
  const { org } = c.req.param();
  const nonce = crypto.randomUUID();
  const state = await signState({ org, nonce }, c.env.SESSION_SECRET);
  const redirectUri = `${c.env.WORKER_BASE_URL}/admin/callback`;
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', c.env.GITHUB_APP_CLIENT_ID);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  return c.redirect(url.toString());
});

admin.get('/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  if (!code || !state) return c.text('Missing code/state', 400);

  const statePayload = await verifyState(state, c.env.SESSION_SECRET);
  if (!statePayload) return c.text('Invalid state', 400);
  const org = statePayload.org;

  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: c.env.GITHUB_APP_CLIENT_ID, client_secret: c.env.GITHUB_APP_CLIENT_SECRET, code }),
  });
  const tokenJson = await tokenRes.json<{ access_token?: string }>();
  const userToken = tokenJson.access_token;
  if (!userToken) return c.text('OAuth exchange failed', 401);

  const userRes = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${userToken}`, 'User-Agent': 'scope3-app', Accept: 'application/vnd.github+json' },
  });
  const user = await userRes.json<{ login?: string }>();
  if (!user.login) return c.text('Cannot read user', 401);

  const memRes = await fetch(`https://api.github.com/orgs/${org}/memberships/${user.login}`, {
    headers: { Authorization: `Bearer ${userToken}`, 'User-Agent': 'scope3-app', Accept: 'application/vnd.github+json' },
  });
  if (!memRes.ok) return c.text('Not a member of this organization', 403);
  const mem = await memRes.json<{ state?: string }>();
  if (mem.state !== 'active') return c.text('Membership not active', 403);

  const token = await signSession({ org, user: user.login, exp: Date.now() + SESSION_TTL_MS }, c.env.SESSION_SECRET);
  c.header('Set-Cookie', sessionCookie(token));
  return c.redirect(`/admin/${org}`);
});

admin.post('/:org/logout', async (c) => {
  c.header('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
  return c.json({ ok: true });
});

export default admin;
