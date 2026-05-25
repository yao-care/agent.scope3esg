# Scope 3 GitHub App — Plan 1: Platform Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 Cloudflare Workers 專案骨架，實作 GitHub webhook 接收與簽章驗證，在 ESG 公司安裝 GitHub App 時自動於其 org 建立 `scope3-inventory` repo（含預設 Labels 與 `config.yml`），並將租戶資訊寫入 Cloudflare D1。

**Architecture:** Hono 作為路由框架運行於 Cloudflare Workers。GitHub 安裝事件觸發 `installation.created` webhook → Worker 驗證 HMAC-SHA256 簽章 → 用安裝 token 呼叫 GitHub API 建立 repo → 寫入 D1 tenants 表。D1 僅存平台設定（非業務資料），業務資料存在各租戶自己的 GitHub repo。

**Tech Stack:** TypeScript、Cloudflare Workers、Hono、Drizzle ORM + D1、`@octokit/app`、Wrangler

---

## 檔案結構

```
scope3-worker/
├── src/
│   ├── index.ts                      # Hono app 入口，路由註冊
│   ├── types.ts                      # 共用型別（Bindings、Variables、Webhook payloads）
│   ├── middleware/
│   │   └── github-webhook.ts         # HMAC-SHA256 webhook 簽章驗證
│   ├── routes/
│   │   ├── webhook.ts                # POST /webhook
│   │   └── health.ts                 # GET /health
│   ├── handlers/
│   │   └── installation.ts           # installation.created 事件處理
│   ├── github/
│   │   ├── app.ts                    # @octokit/app 初始化
│   │   └── repo.ts                   # 建立 repo、labels 的 helper
│   └── db/
│       ├── schema.ts                 # Drizzle D1 schema
│       └── queries.ts                # DB CRUD helpers
├── tests/
│   ├── middleware/
│   │   └── github-webhook.test.ts
│   ├── handlers/
│   │   └── installation.test.ts
│   └── github/
│       └── repo.test.ts
├── migrations/
│   └── 0001_initial.sql
├── repo-template/                    # 新租戶 repo 的初始檔案
│   ├── config.yml
│   └── .github/
│       └── ISSUE_TEMPLATE/
│           └── scope3-submission.yml
├── .github/
│   └── workflows/
│       └── deploy.yml                # push to main → wrangler deploy
├── wrangler.toml
├── drizzle.config.ts
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

---

## Task 1: 初始化 Cloudflare Workers 專案

**Files:**
- Create: `scope3-worker/package.json`
- Create: `scope3-worker/wrangler.toml`
- Create: `scope3-worker/tsconfig.json`
- Create: `scope3-worker/vitest.config.ts`

- [ ] **Step 1: 建立目錄並安裝依賴**

```bash
mkdir scope3-worker && cd scope3-worker
npm init -y
npm install hono @octokit/app drizzle-orm
npm install -D wrangler typescript @cloudflare/workers-types \
  vitest @cloudflare/vitest-pool-workers drizzle-kit
```

- [ ] **Step 2: 建立 `wrangler.toml`**

```toml
name = "scope3-worker"
main = "src/index.ts"
compatibility_date = "2024-12-01"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "scope3"
database_id = "REPLACE_AFTER_wrangler_d1_create"

[vars]
GITHUB_APP_ID = ""

# Secrets（set via: wrangler secret put <KEY>）:
# GITHUB_APP_PRIVATE_KEY
# GITHUB_WEBHOOK_SECRET
# GITHUB_APP_CLIENT_ID
# GITHUB_APP_CLIENT_SECRET
# RESEND_API_KEY
```

- [ ] **Step 3: 建立 `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "types": ["@cloudflare/workers-types"],
    "lib": ["ES2022"]
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 4: 建立 `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    pool: '@cloudflare/vitest-pool-workers',
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
      },
    },
  },
});
```

- [ ] **Step 5: 驗證設定**

```bash
npx wrangler --version
npx tsc --noEmit
```

Expected: 兩個指令都無錯誤輸出。

- [ ] **Step 6: Commit**

```bash
git add package.json wrangler.toml tsconfig.json vitest.config.ts
git commit -m "chore: initialize Cloudflare Workers project"
```

---

## Task 2: 型別定義

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: 寫型別**

```typescript
// src/types.ts

export interface Bindings {
  DB: D1Database;
  GITHUB_APP_ID: string;
  GITHUB_APP_PRIVATE_KEY: string;
  GITHUB_WEBHOOK_SECRET: string;
  GITHUB_APP_CLIENT_ID: string;
  GITHUB_APP_CLIENT_SECRET: string;
  RESEND_API_KEY: string;
}

export interface Variables {
  rawBody: string;
}

export interface GitHubInstallationPayload {
  action: 'created' | 'deleted' | 'suspend' | 'unsuspend';
  installation: {
    id: number;
    account: {
      login: string;
      type: 'Organization' | 'User';
    };
  };
}
```

- [ ] **Step 2: 確認型別無誤**

```bash
npx tsc --noEmit
```

Expected: 無錯誤。

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add shared TypeScript types"
```

---

## Task 3: D1 Schema 與 Migration

**Files:**
- Create: `src/db/schema.ts`
- Create: `migrations/0001_initial.sql`
- Create: `drizzle.config.ts`

- [ ] **Step 1: 建立 Drizzle schema**

```typescript
// src/db/schema.ts
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const tenants = sqliteTable('tenants', {
  installationId: integer('installation_id').primaryKey(),
  org:            text('org').notNull(),
  repoNodeId:     text('repo_node_id'),
  createdAt:      text('created_at').notNull(),
});

export const supplierTokens = sqliteTable('supplier_tokens', {
  token:       text('token').primaryKey(),
  org:         text('org').notNull(),
  supplierId:  text('supplier_id').notNull(),
  expiresAt:   text('expires_at').notNull(),
  createdAt:   text('created_at').notNull(),
});

export const pullJobs = sqliteTable('pull_jobs', {
  jobId:      text('job_id').primaryKey(),
  org:        text('org').notNull(),
  supplierId: text('supplier_id').notNull(),
  apiUrl:     text('api_url').notNull(),
  schedule:   text('schedule').notNull(),
  lastRunAt:  text('last_run_at'),
});

export const auditLog = sqliteTable('audit_log', {
  id:        text('id').primaryKey(),
  org:       text('org').notNull(),
  action:    text('action').notNull(),
  actor:     text('actor').notNull(),
  target:    text('target').notNull(),
  createdAt: text('created_at').notNull(),
});
```

- [ ] **Step 2: 建立 `drizzle.config.ts`**

```typescript
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out:    './migrations',
  driver: 'd1-http',
});
```

- [ ] **Step 3: 建立 migration SQL**

```sql
-- migrations/0001_initial.sql
CREATE TABLE tenants (
  installation_id INTEGER PRIMARY KEY,
  org             TEXT NOT NULL,
  repo_node_id    TEXT,
  created_at      TEXT NOT NULL
);

CREATE TABLE supplier_tokens (
  token       TEXT PRIMARY KEY,
  org         TEXT NOT NULL,
  supplier_id TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE pull_jobs (
  job_id      TEXT PRIMARY KEY,
  org         TEXT NOT NULL,
  supplier_id TEXT NOT NULL,
  api_url     TEXT NOT NULL,
  schedule    TEXT NOT NULL,
  last_run_at TEXT
);

CREATE TABLE audit_log (
  id         TEXT PRIMARY KEY,
  org        TEXT NOT NULL,
  action     TEXT NOT NULL,
  actor      TEXT NOT NULL,
  target     TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

- [ ] **Step 4: 建立本地 D1 並套用 migration**

```bash
npx wrangler d1 create scope3
# 將回傳的 database_id 填入 wrangler.toml

npx wrangler d1 execute scope3 --local --file=migrations/0001_initial.sql
```

Expected: `Successfully executed` 訊息，無錯誤。

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts drizzle.config.ts migrations/0001_initial.sql wrangler.toml
git commit -m "feat: add D1 schema and initial migration"
```

---

## Task 4: DB Query Helpers

**Files:**
- Create: `src/db/queries.ts`
- Create: `tests/db/queries.test.ts`

- [ ] **Step 1: 建立測試 D1 migration helper**

```typescript
// tests/helpers/migrate.ts
import { readFileSync } from 'fs';
import { resolve } from 'path';

export async function applyMigrations(db: D1Database): Promise<void> {
  const sql = readFileSync(resolve('migrations/0001_initial.sql'), 'utf-8');
  for (const stmt of sql.split(';').map(s => s.trim()).filter(Boolean)) {
    await db.prepare(stmt).run();
  }
}
```

- [ ] **Step 2: 寫失敗的測試**

```typescript
// tests/db/queries.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import { applyMigrations } from '../helpers/migrate';
import { insertTenant, getTenant } from '../../src/db/queries';

describe('insertTenant / getTenant', () => {
  beforeAll(async () => {
    await applyMigrations(env.DB);
  });

  it('inserts and retrieves a tenant by installationId', async () => {
    await insertTenant(env.DB, { installationId: 1, org: 'test-org', repoNodeId: 'R_123' });
    const tenant = await getTenant(env.DB, 1);
    expect(tenant?.org).toBe('test-org');
    expect(tenant?.repoNodeId).toBe('R_123');
  });
});
```

- [ ] **Step 3: 執行測試確認失敗**

```bash
npx vitest run tests/db/queries.test.ts
```

Expected: FAIL — `insertTenant is not a function`

- [ ] **Step 3: 實作 query helpers**

```typescript
// src/db/queries.ts
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
```

- [ ] **Step 4: 執行測試確認通過**

```bash
npx vitest run tests/db/queries.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/db/queries.ts tests/db/queries.test.ts tests/helpers/migrate.ts
git commit -m "feat: add D1 query helpers for tenants"
```

---

## Task 5: GitHub Webhook 簽章驗證 Middleware

**Files:**
- Create: `src/middleware/github-webhook.ts`
- Create: `tests/middleware/github-webhook.test.ts`

- [ ] **Step 1: 寫失敗的測試**

```typescript
// tests/middleware/github-webhook.test.ts
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { verifyGitHubWebhook } from '../../src/middleware/github-webhook';
import { Bindings, Variables } from '../../src/types';

function makeApp(secret: string) {
  const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
  app.post('/webhook', verifyGitHubWebhook, (c) => c.text('ok'));
  return app;
}

async function sign(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return 'sha256=' + Array.from(new Uint8Array(mac))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

describe('verifyGitHubWebhook', () => {
  it('returns 401 when signature header is missing', async () => {
    const app = makeApp('secret');
    const res = await app.request('/webhook', { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
  });

  it('returns 401 when signature is wrong', async () => {
    const app = makeApp('secret');
    const res = await app.request('/webhook', {
      method: 'POST',
      body: '{}',
      headers: { 'x-hub-signature-256': 'sha256=badhash' },
    });
    expect(res.status).toBe(401);
  });

  it('passes when signature is correct', async () => {
    const body = '{"action":"created"}';
    const sig = await sign(body, 'mysecret');
    const app = makeApp('mysecret');
    const res = await app.request('/webhook', {
      method: 'POST',
      body,
      headers: { 'x-hub-signature-256': sig },
    });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

```bash
npx vitest run tests/middleware/github-webhook.test.ts
```

Expected: FAIL — `verifyGitHubWebhook is not a function`

- [ ] **Step 3: 實作 middleware**

```typescript
// src/middleware/github-webhook.ts
import { createMiddleware } from 'hono/factory';
import { Bindings, Variables } from '../types';

export const verifyGitHubWebhook = createMiddleware<{
  Bindings: Bindings;
  Variables: Variables;
}>(async (c, next) => {
  const signature = c.req.header('x-hub-signature-256');
  if (!signature || !signature.startsWith('sha256=')) {
    return c.text('Missing signature', 401);
  }

  const body = await c.req.text();
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(c.env.GITHUB_WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );

  const sigBytes = Uint8Array.from(
    signature.slice(7).match(/.{2}/g)!.map(h => parseInt(h, 16)),
  );

  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    sigBytes,
    new TextEncoder().encode(body),
  );

  if (!valid) return c.text('Invalid signature', 401);

  c.set('rawBody', body);
  await next();
});
```

- [ ] **Step 4: 執行測試確認通過**

```bash
npx vitest run tests/middleware/github-webhook.test.ts
```

Expected: PASS（3 tests）

- [ ] **Step 5: Commit**

```bash
git add src/middleware/github-webhook.ts tests/middleware/github-webhook.test.ts
git commit -m "feat: add GitHub webhook HMAC-SHA256 verification middleware"
```

---

## Task 6: GitHub App 身份驗證

**Files:**
- Create: `src/github/app.ts`

- [ ] **Step 1: 實作 GitHub App client**

```typescript
// src/github/app.ts
import { App } from '@octokit/app';
import { Bindings } from '../types';

export function createGitHubApp(env: Bindings): App {
  return new App({
    appId:    env.GITHUB_APP_ID,
    privateKey: env.GITHUB_APP_PRIVATE_KEY,
    webhooks: { secret: env.GITHUB_WEBHOOK_SECRET },
  });
}

export async function getInstallationOctokit(env: Bindings, installationId: number) {
  return createGitHubApp(env).getInstallationOctokit(installationId);
}
```

> 注意：`getInstallationOctokit` 會自動快取 token 並在過期前自動換發，不需要自行管理 token 生命週期。

- [ ] **Step 2: 確認 TypeScript 無誤**

```bash
npx tsc --noEmit
```

Expected: 無錯誤。

- [ ] **Step 3: Commit**

```bash
git add src/github/app.ts
git commit -m "feat: add GitHub App authentication helper"
```

---

## Task 7: Repo 建立邏輯

**Files:**
- Create: `src/github/repo.ts`
- Create: `tests/github/repo.test.ts`
- Create: `repo-template/config.yml`
- Create: `repo-template/.github/ISSUE_TEMPLATE/scope3-submission.yml`

- [ ] **Step 1: 建立 repo template 檔案**

```yaml
# repo-template/config.yml
inventory_year: 2025
enabled_categories: [1, 4, 6, 7, 11]

suppliers: []
  # - id: SUP001
  #   name: 供應商名稱
  #   contact: esg@supplier.com
  #   pull_api: null
  #   pull_schedule: null
```

```yaml
# repo-template/.github/ISSUE_TEMPLATE/scope3-submission.yml
name: Scope 3 Data Submission
description: 供應商碳排資料提交
body:
  - type: textarea
    id: data
    attributes:
      label: Submission Data (JSON)
      description: 由系統自動填入，請勿手動編輯
    validations:
      required: true
```

- [ ] **Step 2: 寫失敗的測試**

```typescript
// tests/github/repo.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createTenantRepo } from '../../src/github/repo';

const mockOctokit = {
  request: vi.fn(),
};

describe('createTenantRepo', () => {
  it('creates repo, commits config.yml, and creates labels', async () => {
    mockOctokit.request
      .mockResolvedValueOnce({ data: { node_id: 'R_abc123' } }) // POST /orgs/{org}/repos
      .mockResolvedValue({ data: {} }); // all subsequent calls (PUT contents, POST labels)

    const nodeId = await createTenantRepo(mockOctokit as any, 'test-org');

    expect(nodeId).toBe('R_abc123');

    // repo created
    expect(mockOctokit.request).toHaveBeenCalledWith(
      'POST /orgs/{org}/repos',
      expect.objectContaining({ org: 'test-org', name: 'scope3-inventory' }),
    );

    // config.yml committed
    expect(mockOctokit.request).toHaveBeenCalledWith(
      'PUT /repos/{owner}/{repo}/contents/{path}',
      expect.objectContaining({ path: 'config.yml' }),
    );

    // at least 20 labels created (5 status + 15 cat)
    const labelCalls = mockOctokit.request.mock.calls.filter(
      ([route]) => route === 'POST /repos/{owner}/{repo}/labels',
    );
    expect(labelCalls.length).toBeGreaterThanOrEqual(20);
  });
});
```

- [ ] **Step 3: 執行測試確認失敗**

```bash
npx vitest run tests/github/repo.test.ts
```

Expected: FAIL — `createTenantRepo is not a function`

- [ ] **Step 4: 實作 repo 建立邏輯**

```typescript
// src/github/repo.ts
import { Octokit } from '@octokit/core';

const LABELS = [
  { name: 'status:submitted',  color: '0075ca', description: '已提交，等待審核' },
  { name: 'status:reviewing',  color: 'e4e669', description: '審核中' },
  { name: 'status:revision',   color: 'd93f0b', description: '需補件' },
  { name: 'status:approved',   color: '0e8a16', description: '已核定' },
  { name: 'status:archived',   color: 'cfd3d7', description: '已歸檔' },
  { name: 'validation:warning',color: 'fbca04', description: '驗證警告' },
  { name: 'validation:error',  color: 'b60205', description: '驗證錯誤' },
  ...Array.from({ length: 15 }, (_, i) => ({
    name:        `cat:${i + 1}`,
    color:       '1d76db',
    description: `Scope 3 Category ${i + 1}`,
  })),
];

const CONFIG_YML = `inventory_year: ${new Date().getFullYear()}
enabled_categories: [1, 4, 6, 7, 11]

suppliers: []
  # - id: SUP001
  #   name: 供應商名稱
  #   contact: esg@supplier.com
  #   pull_api: null
  #   pull_schedule: null
`;

const ISSUE_TEMPLATE = `name: Scope 3 Data Submission
description: 供應商碳排資料提交
body:
  - type: textarea
    id: data
    attributes:
      label: Submission Data (JSON)
      description: 由系統自動填入，請勿手動編輯
    validations:
      required: true
`;

export async function createTenantRepo(octokit: Octokit, org: string): Promise<string> {
  const { data: repo } = await octokit.request('POST /orgs/{org}/repos', {
    org,
    name:        'scope3-inventory',
    description: 'Scope 3 碳排資料盤點系統（由 Scope3 GitHub App 管理）',
    private:     true,
    auto_init:   false,
  });

  await octokit.request('PUT /repos/{owner}/{repo}/contents/{path}', {
    owner:   org,
    repo:    'scope3-inventory',
    path:    'config.yml',
    message: 'chore: initialize Scope 3 inventory',
    content: btoa(unescape(encodeURIComponent(CONFIG_YML))),
  });

  await octokit.request('PUT /repos/{owner}/{repo}/contents/{path}', {
    owner:   org,
    repo:    'scope3-inventory',
    path:    '.github/ISSUE_TEMPLATE/scope3-submission.yml',
    message: 'chore: add issue template',
    content: btoa(unescape(encodeURIComponent(ISSUE_TEMPLATE))),
  });

  for (const label of LABELS) {
    await octokit.request('POST /repos/{owner}/{repo}/labels', {
      owner: org,
      repo:  'scope3-inventory',
      ...label,
    });
  }

  return repo.node_id;
}
```

- [ ] **Step 5: 執行測試確認通過**

```bash
npx vitest run tests/github/repo.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/github/repo.ts tests/github/repo.test.ts \
  repo-template/config.yml \
  "repo-template/.github/ISSUE_TEMPLATE/scope3-submission.yml"
git commit -m "feat: add tenant repo creation with labels and templates"
```

---

## Task 8: Installation 事件處理器

**Files:**
- Create: `src/handlers/installation.ts`
- Create: `tests/handlers/installation.test.ts`

- [ ] **Step 1: 寫失敗的測試**

```typescript
// tests/handlers/installation.test.ts
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import { applyMigrations } from '../helpers/migrate';
import { handleInstallation } from '../../src/handlers/installation';
import type { GitHubInstallationPayload } from '../../src/types';

vi.mock('../../src/github/app', () => ({
  getInstallationOctokit: vi.fn().mockResolvedValue({
    request: vi.fn()
      .mockResolvedValueOnce({ data: { node_id: 'R_test' } })
      .mockResolvedValue({ data: {} }),
  }),
}));

vi.mock('../../src/github/repo', () => ({
  createTenantRepo: vi.fn().mockResolvedValue('R_test'),
}));

describe('handleInstallation', () => {
  beforeAll(async () => {
    await applyMigrations(env.DB);
  });

  const payload: GitHubInstallationPayload = {
    action: 'created',
    installation: {
      id: 999,
      account: { login: 'acme-corp', type: 'Organization' },
    },
  };

  it('inserts tenant into D1 on installation.created', async () => {
    await handleInstallation(env as any, payload);

    const result = await env.DB.prepare(
      'SELECT * FROM tenants WHERE installation_id = 999',
    ).first();

    expect(result).not.toBeNull();
    expect(result?.org).toBe('acme-corp');
    expect(result?.repo_node_id).toBe('R_test');
  });

  it('does nothing on installation.deleted', async () => {
    const deletedPayload = { ...payload, action: 'deleted' as const };
    await handleInstallation(env as any, deletedPayload);

    const result = await env.DB.prepare(
      'SELECT count(*) as cnt FROM tenants',
    ).first<{ cnt: number }>();
    expect(result?.cnt).toBe(0);
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

```bash
npx vitest run tests/handlers/installation.test.ts
```

Expected: FAIL — `handleInstallation is not a function`

- [ ] **Step 3: 實作 handler**

```typescript
// src/handlers/installation.ts
import { getInstallationOctokit } from '../github/app';
import { createTenantRepo } from '../github/repo';
import { insertTenant } from '../db/queries';
import { Bindings, GitHubInstallationPayload } from '../types';

export async function handleInstallation(
  env: Bindings,
  payload: GitHubInstallationPayload,
): Promise<void> {
  if (payload.action !== 'created') return;

  const { id: installationId, account } = payload.installation;
  const org = account.login;

  const octokit = await getInstallationOctokit(env, installationId);
  const repoNodeId = await createTenantRepo(octokit, org);

  await insertTenant(env.DB, { installationId, org, repoNodeId });
}
```

- [ ] **Step 4: 執行測試確認通過**

```bash
npx vitest run tests/handlers/installation.test.ts
```

Expected: PASS（2 tests）

- [ ] **Step 5: Commit**

```bash
git add src/handlers/installation.ts tests/handlers/installation.test.ts
git commit -m "feat: handle GitHub App installation.created event"
```

---

## Task 9: Webhook 路由與 App 入口

**Files:**
- Create: `src/routes/webhook.ts`
- Create: `src/routes/health.ts`
- Create: `src/index.ts`

- [ ] **Step 1: 建立 webhook 路由**

```typescript
// src/routes/webhook.ts
import { Hono } from 'hono';
import { Bindings, Variables } from '../types';
import { verifyGitHubWebhook } from '../middleware/github-webhook';
import { handleInstallation } from '../handlers/installation';

const webhook = new Hono<{ Bindings: Bindings; Variables: Variables }>();

webhook.post('/', verifyGitHubWebhook, async (c) => {
  const event = c.req.header('x-github-event') ?? '';
  const body = JSON.parse(c.get('rawBody'));

  switch (event) {
    case 'installation':
      await handleInstallation(c.env, body);
      break;
    case 'ping':
      break;
    // 後續 Plan 2、3 會在此新增更多 case
  }

  return c.text('ok');
});

export default webhook;
```

- [ ] **Step 2: 建立 health 路由**

```typescript
// src/routes/health.ts
import { Hono } from 'hono';

const health = new Hono();
health.get('/', (c) => c.json({ status: 'ok', version: '1.0.0' }));
export default health;
```

- [ ] **Step 3: 建立 app 入口**

```typescript
// src/index.ts
import { Hono } from 'hono';
import { Bindings, Variables } from './types';
import webhookRoute from './routes/webhook';
import healthRoute from './routes/health';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.route('/webhook', webhookRoute);
app.route('/health',  healthRoute);

export default app;
```

- [ ] **Step 4: 執行全部測試確認綠燈**

```bash
npx vitest run
```

Expected: 全部 PASS

- [ ] **Step 5: 本地啟動確認 `/health` 回應**

```bash
npx wrangler dev --local
curl http://localhost:8787/health
```

Expected: `{"status":"ok","version":"1.0.0"}`

- [ ] **Step 6: Commit**

```bash
git add src/routes/webhook.ts src/routes/health.ts src/index.ts
git commit -m "feat: wire up Hono app with webhook and health routes"
```

---

## Task 10: 部署 GitHub Actions Workflow

**Files:**
- Create: `.github/workflows/deploy.yml`

- [ ] **Step 1: 建立 deploy workflow**

```yaml
# .github/workflows/deploy.yml
name: Deploy to Cloudflare Workers

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - run: npm ci

      - run: npm test

      - name: Deploy
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

> Secrets 需在 GitHub repo Settings → Secrets 設定：
> - `CLOUDFLARE_API_TOKEN`：Cloudflare API Token（Workers 部署權限）
> - `CLOUDFLARE_ACCOUNT_ID`：Cloudflare 帳號 ID

- [ ] **Step 2: 在 `package.json` 加入 test script**

在 `package.json` 的 `scripts` 加入：

```json
{
  "scripts": {
    "test": "vitest run",
    "dev": "wrangler dev --local",
    "deploy": "wrangler deploy"
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy.yml package.json
git commit -m "ci: add Cloudflare Workers deploy workflow"
```

---

## Task 11: GitHub App 向 GitHub 註冊（手動步驟）

> 此 Task 需人工操作 GitHub 網頁，無法自動化。

- [ ] **Step 1: 前往 GitHub 建立 GitHub App**

至 `https://github.com/organizations/{YOUR_ORG}/settings/apps/new`

填寫：
- **App name**: `Scope3 Carbon Inventory`
- **Homepage URL**: `https://scope3.yao.care`
- **Webhook URL**: `https://scope3.yao.care/webhook`（部署後的 Worker URL）
- **Webhook secret**: 產生一組隨機字串並記錄

**Permissions（Repository）：**
- Issues: Read & Write
- Contents: Read & Write
- Pages: Write
- Actions: Read & Write

**Subscribe to events：**
- `installation`
- `issues`
- `issue_comment`
- `label`

- [ ] **Step 2: 產生 Private Key 並設定 Cloudflare Secrets**

```bash
# 下載 .pem 後設定 Wrangler secrets
wrangler secret put GITHUB_APP_ID         # 填入 App ID（數字）
wrangler secret put GITHUB_APP_PRIVATE_KEY # 貼入 .pem 全文
wrangler secret put GITHUB_WEBHOOK_SECRET  # 填入上面的 webhook secret
wrangler secret put GITHUB_APP_CLIENT_ID
wrangler secret put GITHUB_APP_CLIENT_SECRET
```

- [ ] **Step 3: 部署 Worker**

```bash
npm run deploy
```

Expected: `https://scope3-worker.<your-account>.workers.dev` 部署成功。

- [ ] **Step 4: 回到 GitHub App 設定，將 Webhook URL 更新為正式 Worker URL**

- [ ] **Step 5: 安裝 App 到測試 org，確認 `scope3-inventory` repo 自動建立**

---

## 驗收標準

Plan 1 完成時，以下全部成立：

- [ ] `npx vitest run` 全部 PASS（middleware、handler、db queries、repo 建立）
- [ ] `GET /health` 回傳 `{"status":"ok"}`
- [ ] 測試 org 安裝 GitHub App 後，`scope3-inventory` repo 自動建立
- [ ] Repo 含有 `config.yml`、Issue Template、22 個 Labels（5 status + 15 cat + 2 validation）
- [ ] D1 tenants 表有對應紀錄

---

## 接下來

Plan 2 將在此基礎上建立：
- 供應商 Web Form（Cloudflare Workers static assets）
- Push API 端點（`POST /api/v1/submit`）
- Pull Job 排程（Cloudflare Queues）
- Cloudflare R2 檔案上傳
- Resend 寄送 onboarding email
