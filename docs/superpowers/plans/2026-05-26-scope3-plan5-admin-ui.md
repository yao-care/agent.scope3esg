# Scope 3 GitHub App — Plan 5: ESG Manager 管理介面

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 Worker 服務的 ESG Manager 管理介面：GitHub OAuth 登入、簽章 session、透過 UI 編輯盤點設定與供應商清單（寫回 `config.yml` 並觸發 token 同步）、檢視供應商連結與提交狀態。

**Architecture:** Worker 新增 `/admin` 路由群（頁面 + OAuth）與 `/api/v1/admin` 路由群（受 session 保護的管理 API）。session 為無狀態 HMAC 簽章 cookie。前端為 vanilla JS 單頁，呼叫管理 API。重用既有 `getInstallationOctokit`、`getTenantByOrg`、`syncConfig`、`listSupplierTokensByOrg`、`generateFormUrl`、`readTenantConfig`。

**Tech Stack:** Hono、Web Crypto（HMAC）、js-yaml、`@octokit/core`、Vitest（node + Cloudflare pool）

---

## 既有可重用程式碼

- `src/github/app.ts` — `getInstallationOctokit(env, installationId)`
- `src/db/queries.ts` — `getTenantByOrg(db, org)`（回 `{installationId, org, repoNodeId}`）、`listSupplierTokensByOrg(db, org)`
- `src/handlers/config-push.ts` — `syncConfig(env, org, installationId)`
- `src/github/config.ts` — `readTenantConfig(octokit, org)` → `TenantConfig | null`
- `src/lib/tokens.ts` — `generateFormUrl(baseUrl, org, token)`
- `src/types.ts` — `TenantConfig`、`SupplierConfig`、`Bindings`
- js-yaml 已安裝

`TenantConfig` = `{ inventory_year: number; enabled_categories: number[]; suppliers: SupplierConfig[] }`
`SupplierConfig` = `{ id: string; name: string; contact: string; pull_api: string|null; pull_schedule: string|null }`

---

## 新增/修改檔案

```
src/
├── types.ts                  MODIFY: Bindings 加 SESSION_SECRET
├── lib/
│   ├── session.ts            NEW: HMAC 簽發/驗證 session 與 state
│   └── config-yaml.ts        NEW: TenantConfig ↔ YAML 轉換 + 驗證
├── routes/
│   ├── admin.ts              NEW: 頁面 + OAuth（login/callback/logout）
│   └── admin-api.ts          NEW: 受保護的管理 API
├── admin/
│   └── page.ts               NEW: 管理頁 HTML+JS 字串
└── index.ts                  MODIFY: 掛載 admin 與 admin-api 路由
tests/
├── lib/
│   ├── session.test.ts       NEW (node pool)
│   └── config-yaml.test.ts   NEW (node pool)
└── routes/
    └── admin-api.test.ts     NEW (Cloudflare pool)
```

---

## Task 1: types 加 SESSION_SECRET

**Files:** Modify `src/types.ts`

- [ ] **Step 1: 在 `Bindings` interface 加入 SESSION_SECRET**

在 `src/types.ts` 的 `Bindings` interface 中，於 `RESEND_API_KEY: string;` 之後加入：

```typescript
  SESSION_SECRET: string;
```

- [ ] **Step 2: 確認 TypeScript**

```bash
cd /Users/lightman/yao.care/agent.scope3esg/scope3-worker
pnpm tsc --noEmit 2>&1 | grep "types.ts" || echo "OK"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
cd /Users/lightman/yao.care/agent.scope3esg
git add scope3-worker/src/types.ts
git commit -m "chore: add SESSION_SECRET binding for admin sessions"
```

---

## Task 2: session 簽發/驗證（TDD）

**Files:** Create `src/lib/session.ts`、`tests/lib/session.test.ts`；Modify `vitest.middleware.config.ts`

- [ ] **Step 1: 更新 `vitest.middleware.config.ts` include 加入 tests/lib**

把 include 改為（保留既有項目）：

```typescript
include: ['tests/middleware/**/*.test.ts', 'tests/github/**/*.test.ts', 'tests/tenant/**/*.test.ts', 'tests/lib/**/*.test.ts'],
```

- [ ] **Step 2: 建立失敗的測試 `tests/lib/session.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { signSession, verifySession, signState, verifyState } from '../../src/lib/session';

const SECRET = 'test-session-secret';

describe('session sign/verify', () => {
  it('round-trips a valid session', async () => {
    const token = await signSession({ org: 'acme', user: 'alice', exp: Date.now() + 10000 }, SECRET);
    const payload = await verifySession(token, SECRET);
    expect(payload?.org).toBe('acme');
    expect(payload?.user).toBe('alice');
  });
  it('rejects a tampered token', async () => {
    const token = await signSession({ org: 'acme', user: 'alice', exp: Date.now() + 10000 }, SECRET);
    const tampered = token.slice(0, -2) + (token.endsWith('aa') ? 'bb' : 'aa');
    expect(await verifySession(tampered, SECRET)).toBeNull();
  });
  it('rejects a wrong secret', async () => {
    const token = await signSession({ org: 'acme', user: 'alice', exp: Date.now() + 10000 }, SECRET);
    expect(await verifySession(token, 'other-secret')).toBeNull();
  });
  it('rejects an expired session', async () => {
    const token = await signSession({ org: 'acme', user: 'alice', exp: Date.now() - 1 }, SECRET);
    expect(await verifySession(token, SECRET)).toBeNull();
  });
  it('returns null for malformed input', async () => {
    expect(await verifySession('garbage', SECRET)).toBeNull();
    expect(await verifySession('', SECRET)).toBeNull();
  });
});

describe('state sign/verify', () => {
  it('round-trips org and nonce', async () => {
    const s = await signState({ org: 'acme', nonce: 'n1' }, SECRET);
    const p = await verifyState(s, SECRET);
    expect(p?.org).toBe('acme');
    expect(p?.nonce).toBe('n1');
  });
  it('rejects a tampered state', async () => {
    const s = await signState({ org: 'acme', nonce: 'n1' }, SECRET);
    expect(await verifyState(s + 'x', SECRET)).toBeNull();
  });
});
```

- [ ] **Step 3: 執行測試確認失敗**

```bash
pnpm vitest run --config vitest.middleware.config.ts tests/lib/session.test.ts 2>&1 | tail -12
```

Expected: FAIL — 找不到模組

- [ ] **Step 4: 實作 `src/lib/session.ts`**

```typescript
// src/lib/session.ts
// 無狀態 HMAC-SHA256 簽章。格式：base64url(JSON).base64url(HMAC)。用於 admin session 與 OAuth state。

function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecodeToString(s: string): string {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return bin;
}

async function hmac(data: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return new Uint8Array(sig);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sign<T>(payload: T, secret: string): Promise<string> {
  const json = JSON.stringify(payload);
  const body = b64urlEncode(new TextEncoder().encode(json));
  const sig = b64urlEncode(await hmac(body, secret));
  return `${body}.${sig}`;
}

async function verify<T>(token: string, secret: string): Promise<T | null> {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = b64urlEncode(await hmac(body, secret));
  if (!timingSafeEqual(sig, expected)) return null;
  try {
    return JSON.parse(b64urlDecodeToString(body)) as T;
  } catch {
    return null;
  }
}

export interface SessionPayload {
  org: string;
  user: string;
  exp: number;
}

export interface StatePayload {
  org: string;
  nonce: string;
}

export async function signSession(payload: SessionPayload, secret: string): Promise<string> {
  return sign(payload, secret);
}

export async function verifySession(token: string, secret: string): Promise<SessionPayload | null> {
  const p = await verify<SessionPayload>(token, secret);
  if (!p) return null;
  if (typeof p.exp !== 'number' || p.exp < Date.now()) return null;
  return p;
}

export async function signState(payload: StatePayload, secret: string): Promise<string> {
  return sign(payload, secret);
}

export async function verifyState(state: string, secret: string): Promise<StatePayload | null> {
  return verify<StatePayload>(state, secret);
}
```

- [ ] **Step 5: 執行測試確認通過**

```bash
pnpm vitest run --config vitest.middleware.config.ts tests/lib/session.test.ts 2>&1 | tail -12
```

Expected: 7 tests PASS

- [ ] **Step 6: Commit**

```bash
cd /Users/lightman/yao.care/agent.scope3esg
git add scope3-worker/src/lib/session.ts scope3-worker/tests/lib/session.test.ts scope3-worker/vitest.middleware.config.ts
git commit -m "feat: add HMAC session and OAuth state signing"
```

---

## Task 3: config YAML 轉換（TDD）

**Files:** Create `src/lib/config-yaml.ts`、`tests/lib/config-yaml.test.ts`

- [ ] **Step 1: 建立失敗的測試 `tests/lib/config-yaml.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { configToYaml, yamlToConfig } from '../../src/lib/config-yaml';

const config = {
  inventory_year: 2026,
  enabled_categories: [1, 4, 6],
  suppliers: [
    { id: 'SUP001', name: '台鋼', contact: 'esg@twsteel.com', pull_api: null, pull_schedule: null },
  ],
};

describe('config-yaml', () => {
  it('round-trips config through YAML', () => {
    const yaml = configToYaml(config);
    const parsed = yamlToConfig(yaml);
    expect(parsed.inventory_year).toBe(2026);
    expect(parsed.enabled_categories).toEqual([1, 4, 6]);
    expect(parsed.suppliers[0].id).toBe('SUP001');
    expect(parsed.suppliers[0].contact).toBe('esg@twsteel.com');
  });
  it('produces valid YAML string', () => {
    const yaml = configToYaml(config);
    expect(yaml).toContain('inventory_year: 2026');
    expect(yaml).toContain('SUP001');
  });
  it('yamlToConfig fills defaults for empty config', () => {
    const parsed = yamlToConfig('inventory_year: 2025\nenabled_categories: []\nsuppliers: []\n');
    expect(parsed.suppliers).toEqual([]);
    expect(parsed.enabled_categories).toEqual([]);
  });
  it('yamlToConfig normalizes missing supplier fields', () => {
    const parsed = yamlToConfig('inventory_year: 2025\nenabled_categories: [1]\nsuppliers:\n  - id: S1\n    name: X\n    contact: x@y.com\n');
    expect(parsed.suppliers[0].pull_api).toBeNull();
    expect(parsed.suppliers[0].pull_schedule).toBeNull();
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

```bash
pnpm vitest run --config vitest.middleware.config.ts tests/lib/config-yaml.test.ts 2>&1 | tail -12
```

Expected: FAIL

- [ ] **Step 3: 實作 `src/lib/config-yaml.ts`**

```typescript
// src/lib/config-yaml.ts
import { load as yamlLoad, dump as yamlDump } from 'js-yaml';
import type { TenantConfig, SupplierConfig } from '../types';

export function configToYaml(config: TenantConfig): string {
  const normalized: TenantConfig = {
    inventory_year: config.inventory_year,
    enabled_categories: config.enabled_categories ?? [],
    suppliers: (config.suppliers ?? []).map(normalizeSupplier),
  };
  return yamlDump(normalized, { lineWidth: 120, noRefs: true });
}

export function yamlToConfig(yaml: string): TenantConfig {
  const raw = (yamlLoad(yaml) ?? {}) as Partial<TenantConfig>;
  return {
    inventory_year: Number(raw.inventory_year) || new Date().getFullYear(),
    enabled_categories: Array.isArray(raw.enabled_categories) ? raw.enabled_categories.map(Number) : [],
    suppliers: Array.isArray(raw.suppliers) ? raw.suppliers.map(normalizeSupplier) : [],
  };
}

function normalizeSupplier(s: Partial<SupplierConfig>): SupplierConfig {
  return {
    id: String(s.id ?? ''),
    name: String(s.name ?? ''),
    contact: String(s.contact ?? ''),
    pull_api: s.pull_api ?? null,
    pull_schedule: s.pull_schedule ?? null,
  };
}
```

- [ ] **Step 4: 執行測試確認通過**

```bash
pnpm vitest run --config vitest.middleware.config.ts tests/lib/config-yaml.test.ts 2>&1 | tail -12
```

Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/lightman/yao.care/agent.scope3esg
git add scope3-worker/src/lib/config-yaml.ts scope3-worker/tests/lib/config-yaml.test.ts
git commit -m "feat: add config TenantConfig<->YAML conversion"
```

---

## Task 4: OAuth 路由（admin.ts）

**Files:** Create `src/routes/admin.ts`；前端頁面先用佔位（Task 6 補完整 HTML）

- [ ] **Step 1: 建立 `src/admin/page.ts`（先放最小 HTML，Task 6 替換）**

```typescript
// src/admin/page.ts
export function adminPageHtml(org: string): string {
  return `<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="UTF-8"><title>Scope 3 管理</title></head>
<body><h1>Scope 3 管理 — ${org}</h1><p>載入中…</p></body></html>`;
}
```

- [ ] **Step 2: 建立 `src/routes/admin.ts`**

```typescript
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

// 管理頁：未登入導向登入
admin.get('/:org', async (c) => {
  const { org } = c.req.param();
  const cookie = readCookie(c, SESSION_COOKIE);
  const session = cookie ? await verifySession(cookie, c.env.SESSION_SECRET) : null;
  if (!session || session.org !== org) {
    return c.redirect(`/admin/${org}/login`);
  }
  return c.html(adminPageHtml(org));
});

// 登入：導向 GitHub OAuth
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

// 回呼：換 token、驗證 org 成員、發 session
admin.get('/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  if (!code || !state) return c.text('Missing code/state', 400);

  const statePayload = await verifyState(state, c.env.SESSION_SECRET);
  if (!statePayload) return c.text('Invalid state', 400);
  const org = statePayload.org;

  // 換 user access token
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: c.env.GITHUB_APP_CLIENT_ID,
      client_secret: c.env.GITHUB_APP_CLIENT_SECRET,
      code,
    }),
  });
  const tokenJson = await tokenRes.json<{ access_token?: string }>();
  const userToken = tokenJson.access_token;
  if (!userToken) return c.text('OAuth exchange failed', 401);

  // 取得登入帳號
  const userRes = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${userToken}`, 'User-Agent': 'scope3-app', Accept: 'application/vnd.github+json' },
  });
  const user = await userRes.json<{ login?: string }>();
  if (!user.login) return c.text('Cannot read user', 401);

  // 驗證 org 成員資格
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

// 登出
admin.post('/:org/logout', async (c) => {
  c.header('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
  return c.json({ ok: true });
});

export default admin;
```

- [ ] **Step 3: 確認 TypeScript**

```bash
pnpm tsc --noEmit 2>&1 | grep -E "admin\.ts|page\.ts" || echo "OK"
```

Expected: `OK`

- [ ] **Step 4: Commit**

```bash
cd /Users/lightman/yao.care/agent.scope3esg
git add scope3-worker/src/routes/admin.ts scope3-worker/src/admin/page.ts
git commit -m "feat: add admin OAuth login/callback/logout routes"
```

---

## Task 5: 管理 API（admin-api.ts，TDD）

**Files:** Create `src/routes/admin-api.ts`、`tests/routes/admin-api.test.ts`；Modify `src/index.ts`

- [ ] **Step 1: 建立失敗的測試 `tests/routes/admin-api.test.ts`**

```typescript
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import { applyMigrations } from '../helpers/migrate';
import { insertTenant, insertSupplierToken } from '../../src/db/queries';
import { signSession } from '../../src/lib/session';
import app from '../../src/index';

vi.mock('../../src/github/app', () => ({
  getInstallationOctokit: vi.fn().mockResolvedValue({ request: vi.fn() }),
}));
vi.mock('../../src/github/config', () => ({
  readTenantConfig: vi.fn().mockResolvedValue({ inventory_year: 2026, enabled_categories: [1], suppliers: [] }),
}));
vi.mock('../../src/handlers/config-push', () => ({
  syncConfig: vi.fn().mockResolvedValue(undefined),
  handleConfigPush: vi.fn().mockResolvedValue(undefined),
}));

async function sessionCookie(org: string) {
  const token = await signSession({ org, user: 'tester', exp: Date.now() + 100000 }, (env as any).SESSION_SECRET);
  return `scope3_session=${token}`;
}

describe('admin API auth', () => {
  beforeAll(async () => {
    await applyMigrations(env.DB);
    await insertTenant(env.DB, { installationId: 900, org: 'acme', repoNodeId: 'R_a' });
    await insertSupplierToken(env.DB, { token: 'stok_1', org: 'acme', supplierId: 'SUP001', expiresAt: '2099-01-01T00:00:00Z' });
  });

  it('rejects requests without a session (401)', async () => {
    const res = await app.request('/api/v1/admin/acme/config', {}, env as any);
    expect(res.status).toBe(401);
  });

  it('rejects session for a different org (401)', async () => {
    const res = await app.request('/api/v1/admin/acme/config', {
      headers: { Cookie: await sessionCookie('other-org') },
    }, env as any);
    expect(res.status).toBe(401);
  });

  it('returns config JSON with a valid session', async () => {
    const res = await app.request('/api/v1/admin/acme/config', {
      headers: { Cookie: await sessionCookie('acme') },
    }, env as any);
    expect(res.status).toBe(200);
    const body = await res.json<{ inventory_year: number }>();
    expect(body.inventory_year).toBe(2026);
  });

  it('lists supplier links with a valid session', async () => {
    const res = await app.request('/api/v1/admin/acme/links', {
      headers: { Cookie: await sessionCookie('acme') },
    }, env as any);
    expect(res.status).toBe(200);
    const body = await res.json<{ links: Array<{ supplierId: string; url: string }> }>();
    expect(body.links.some((l) => l.supplierId === 'SUP001')).toBe(true);
  });
});
```

注意：`env.SESSION_SECRET` 需在測試環境提供。請在 `vitest.config.ts` 的 `miniflare.bindings` 加入 `SESSION_SECRET: 'test-session-secret'`（與既有 `RESEND_API_KEY` 並列）。

- [ ] **Step 2: 在 `vitest.config.ts` 的 miniflare.bindings 加入 SESSION_SECRET**

```typescript
        bindings: { RESEND_API_KEY: 'test_re_key', SESSION_SECRET: 'test-session-secret' },
```

- [ ] **Step 3: 執行測試確認失敗**

```bash
pnpm vitest run tests/routes/admin-api.test.ts 2>&1 | tail -12
```

Expected: FAIL（路由不存在 → 404）

- [ ] **Step 4: 建立 `src/routes/admin-api.ts`**

```typescript
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

// session 驗證 middleware：確認 cookie 有效且 org 相符
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

// GET config
adminApi.get('/:org/config', async (c) => {
  const { org } = c.req.param();
  const tenant = await getTenantByOrg(c.env.DB, org);
  if (!tenant) return c.json({ error: 'unknown org' }, 404);
  const octokit = await getInstallationOctokit(c.env, tenant.installationId);
  const config = await readTenantConfig(octokit, org);
  return c.json(config ?? { inventory_year: new Date().getFullYear(), enabled_categories: [], suppliers: [] });
});

// PUT config → 寫回 config.yml → syncConfig
adminApi.put('/:org/config', async (c) => {
  const { org } = c.req.param();
  const tenant = await getTenantByOrg(c.env.DB, org);
  if (!tenant) return c.json({ error: 'unknown org' }, 404);
  const incoming = await c.req.json<TenantConfig>();
  const yaml = configToYaml(incoming);

  const octokit = await getInstallationOctokit(c.env, tenant.installationId);
  // 取現有 sha（更新需要）
  let sha: string | undefined;
  try {
    const res = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
      owner: org, repo: 'scope3-inventory', path: 'config.yml',
    });
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

// GET supplier links
adminApi.get('/:org/links', async (c) => {
  const { org } = c.req.param();
  const tokens = await listSupplierTokensByOrg(c.env.DB, org);
  const links = tokens.map((t) => ({
    supplierId: t.supplierId,
    url: generateFormUrl(c.env.WORKER_BASE_URL, org, t.token),
  }));
  return c.json({ links });
});

// GET submissions status（查 repo issues）
adminApi.get('/:org/submissions', async (c) => {
  const { org } = c.req.param();
  const tenant = await getTenantByOrg(c.env.DB, org);
  if (!tenant) return c.json({ error: 'unknown org' }, 404);
  const octokit = await getInstallationOctokit(c.env, tenant.installationId);
  const { data: issues } = await octokit.request('GET /repos/{owner}/{repo}/issues', {
    owner: org, repo: 'scope3-inventory', state: 'all', per_page: 100,
  });
  const items = (issues as Array<{ number: number; title: string; labels: Array<{ name: string }> }>).map((i) => ({
    number: i.number,
    title: i.title,
    status: (i.labels.map((l) => l.name).find((n) => n.startsWith('status:')) ?? 'status:submitted').replace('status:', ''),
  }));
  return c.json({ submissions: items });
});

export default adminApi;
```

- [ ] **Step 5: 在 `src/index.ts` 掛載 admin 與 admin-api**

加入 import：

```typescript
import adminRoute     from './routes/admin';
import adminApiRoute  from './routes/admin-api';
```

在其他 `app.route(...)` 之間加入（export 區塊之前）：

```typescript
app.route('/admin',          adminRoute);
app.route('/api/v1/admin',   adminApiRoute);
```

- [ ] **Step 6: 執行測試確認通過**

```bash
pnpm vitest run tests/routes/admin-api.test.ts 2>&1 | tail -12
```

Expected: 4 tests PASS

- [ ] **Step 7: Commit**

```bash
cd /Users/lightman/yao.care/agent.scope3esg
git add scope3-worker/src/routes/admin-api.ts scope3-worker/tests/routes/admin-api.test.ts scope3-worker/src/index.ts scope3-worker/vitest.config.ts
git commit -m "feat: add session-protected admin API (config/links/submissions)"
```

---

## Task 6: 管理頁前端（完整 HTML+JS）

**Files:** Modify `src/admin/page.ts`

- [ ] **Step 1: 用完整單頁介面替換 `src/admin/page.ts`**

```typescript
// src/admin/page.ts
export function adminPageHtml(org: string): string {
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Scope 3 管理 — ${org}</title>
<style>
  body { font-family: -apple-system, "Segoe UI", sans-serif; max-width: 900px; margin: 0 auto; padding: 24px; background: #f7f8fa; color: #1a1a1a; }
  h1 { font-size: 1.4rem; } h2 { font-size: 1.05rem; margin-top: 0; }
  section { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin-bottom: 20px; }
  label { font-size: .85rem; color: #555; }
  input, select { padding: 6px; border: 1px solid #ccc; border-radius: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: .9rem; }
  th, td { text-align: left; padding: 6px; border-bottom: 1px solid #eee; }
  button { padding: 8px 16px; background: #0070f3; color: #fff; border: none; border-radius: 4px; cursor: pointer; }
  button.secondary { background: #eee; color: #333; }
  button.danger { background: #d93f0b; }
  .cats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; font-size: .85rem; }
  .row-actions { white-space: nowrap; }
  .toast { position: fixed; top: 16px; right: 16px; background: #0e8a16; color: #fff; padding: 12px 20px; border-radius: 4px; display: none; }
  code { background: #f0f0f0; padding: 2px 4px; border-radius: 3px; font-size: .8rem; }
</style>
</head>
<body>
<h1>Scope 3 盤點管理 — ${org}</h1>

<section>
  <h2>① 盤點設定</h2>
  <label>盤點年度 <input id="year" type="number" style="width:100px"></label>
  <p style="margin:12px 0 4px">盤查類別（Scope 3 Category）</p>
  <div class="cats" id="cats"></div>
</section>

<section>
  <h2>② 供應商清單</h2>
  <table><thead><tr><th>ID</th><th>名稱</th><th>聯絡 Email</th><th>Pull API</th><th>排程</th><th></th></tr></thead>
  <tbody id="suppliers"></tbody></table>
  <p><button class="secondary" onclick="addRow()">+ 新增供應商</button></p>
</section>

<p><button onclick="save()">💾 儲存設定</button> <span id="saveStatus" style="color:#555;font-size:.85rem"></span></p>

<section>
  <h2>③ 供應商連結一覽</h2>
  <table><thead><tr><th>供應商</th><th>填表連結</th><th></th></tr></thead><tbody id="links"></tbody></table>
</section>

<section>
  <h2>④ 提交狀態</h2>
  <table><thead><tr><th>#</th><th>標題</th><th>狀態</th></tr></thead><tbody id="subs"></tbody></table>
</section>

<div class="toast" id="toast"></div>

<script>
const ORG = ${JSON.stringify(org)};
const CAT_NAMES = ['採購商品與服務','資本財','燃料與能源','上游運輸配送','營運廢棄物','商務旅行','員工通勤','上游租賃資產','下游運輸配送','售出產品加工','售出產品使用','售出產品報廢','下游租賃資產','加盟','投資'];

function toast(msg){ const t=document.getElementById('toast'); t.textContent=msg; t.style.display='block'; setTimeout(()=>t.style.display='none',2500); }

function renderCats(enabled){
  document.getElementById('cats').innerHTML = CAT_NAMES.map((n,i)=>{
    const c=i+1; const ck=enabled.includes(c)?'checked':'';
    return '<label><input type="checkbox" class="cat" value="'+c+'" '+ck+'> '+c+'. '+n+'</label>';
  }).join('');
}

function supplierRow(s){
  s=s||{id:'',name:'',contact:'',pull_api:'',pull_schedule:''};
  return '<tr>'+
    '<td><input class="s-id" value="'+(s.id||'')+'"></td>'+
    '<td><input class="s-name" value="'+(s.name||'')+'"></td>'+
    '<td><input class="s-contact" value="'+(s.contact||'')+'"></td>'+
    '<td><input class="s-api" value="'+(s.pull_api||'')+'"></td>'+
    '<td><input class="s-sched" value="'+(s.pull_schedule||'')+'"></td>'+
    '<td class="row-actions"><button class="danger" onclick="this.closest(\\'tr\\').remove()">刪</button></td></tr>';
}
function addRow(){ document.getElementById('suppliers').insertAdjacentHTML('beforeend', supplierRow()); }

function collectConfig(){
  const enabled = [...document.querySelectorAll('.cat:checked')].map(e=>Number(e.value));
  const suppliers = [...document.querySelectorAll('#suppliers tr')].map(tr=>({
    id: tr.querySelector('.s-id').value.trim(),
    name: tr.querySelector('.s-name').value.trim(),
    contact: tr.querySelector('.s-contact').value.trim(),
    pull_api: tr.querySelector('.s-api').value.trim() || null,
    pull_schedule: tr.querySelector('.s-sched').value.trim() || null,
  })).filter(s=>s.id);
  return { inventory_year: Number(document.getElementById('year').value)||new Date().getFullYear(), enabled_categories: enabled, suppliers };
}

async function load(){
  const cfg = await (await fetch('/api/v1/admin/'+ORG+'/config')).json();
  document.getElementById('year').value = cfg.inventory_year;
  renderCats(cfg.enabled_categories||[]);
  document.getElementById('suppliers').innerHTML = (cfg.suppliers||[]).map(supplierRow).join('') || supplierRow();
  await loadLinks();
  await loadSubs();
}

async function loadLinks(){
  const { links } = await (await fetch('/api/v1/admin/'+ORG+'/links')).json();
  document.getElementById('links').innerHTML = links.map(l=>
    '<tr><td>'+l.supplierId+'</td><td><code>'+l.url+'</code></td>'+
    '<td><button class="secondary" onclick="navigator.clipboard.writeText(\\''+l.url+'\\');toast(\\'已複製\\')">複製</button></td></tr>'
  ).join('') || '<tr><td colspan="3" style="color:#888">尚無連結</td></tr>';
}

async function loadSubs(){
  const { submissions } = await (await fetch('/api/v1/admin/'+ORG+'/submissions')).json();
  document.getElementById('subs').innerHTML = submissions.map(s=>
    '<tr><td>'+s.number+'</td><td>'+s.title+'</td><td>'+s.status+'</td></tr>'
  ).join('') || '<tr><td colspan="3" style="color:#888">尚無提交</td></tr>';
}

async function save(){
  document.getElementById('saveStatus').textContent='儲存中…';
  const res = await fetch('/api/v1/admin/'+ORG+'/config', {method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(collectConfig())});
  if(res.ok){ toast('已儲存，連結已更新'); document.getElementById('saveStatus').textContent='✅ 已儲存'; await loadLinks(); }
  else { toast('儲存失敗'); document.getElementById('saveStatus').textContent='❌ 失敗'; }
}

load();
</script>
</body>
</html>`;
}
```

- [ ] **Step 2: 確認 TypeScript**

```bash
pnpm tsc --noEmit 2>&1 | grep "page.ts" || echo "OK"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
cd /Users/lightman/yao.care/agent.scope3esg
git add scope3-worker/src/admin/page.ts
git commit -m "feat: add full admin single-page UI"
```

---

## Task 7: 全套測試 + 部署設定

**Files:** 驗證；如需則調整

- [ ] **Step 1: 兩個 pool 全套測試**

```bash
cd /Users/lightman/yao.care/agent.scope3esg/scope3-worker
pnpm test 2>&1 | grep -E "Test Files|Tests|failed"
pnpm tsc --noEmit 2>&1 | grep -E "^src/" || echo "src clean"
```

Expected: 兩 pool 全綠；src clean

- [ ] **Step 2: Commit（若有調整）並 push**

```bash
cd /Users/lightman/yao.care/agent.scope3esg
git push
```

---

## 驗收標準

- [ ] `src/lib/session.ts`、`config-yaml.ts` 純函式測試全綠
- [ ] admin API 在無 session / org 不符時回 401
- [ ] 有效 session 可讀 config、列連結
- [ ] 兩個 vitest pool 全套測試 PASS、src TypeScript 乾淨

---

## 部署後需使用者/Claude 完成（不在程式碼內）

- **Claude 做**：`wrangler secret put SESSION_SECRET`（用 `openssl rand -hex 32` 產隨機值）。
- **使用者做**：App 設定頁「Client secrets → Generate a new client secret」→ 提供給 Claude → `wrangler secret put GITHUB_APP_CLIENT_SECRET`。
- **使用者做**：App 設定頁設定 OAuth Callback URL = `https://scope3-worker.lightman-chang.workers.dev/admin/callback`，並確認已啟用 user authorization。
- 部署後驗證：瀏覽器開 `https://scope3-worker.lightman-chang.workers.dev/admin/yao-care` → GitHub 登入 → 管理頁。
