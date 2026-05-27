# Scope 3 GitHub App — Plan 2: Supplier Data Ingestion

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立三種供應商資料接收管道（Web Form、Push API、Pull Job），加上支援基礎設施（token 管理、GitHub Issue 建立、R2 檔案上傳、Resend email、config.yml 變更觸發 onboarding）。

**Architecture:** 每個管道驗證存在 D1 的 supplier token，呼叫共用的 `processSubmission()` handler 在租戶的 `scope3-inventory` repo 建立結構化 GitHub Issue。佐證檔案存 Cloudflare R2。當 ESG Manager push 更新 `config.yml` 時，Worker 為新供應商產生 token 並寄送 onboarding email。Pull Job 透過 Cloudflare Queues 排程定期向供應商 API 拉取資料。

**Tech Stack:** Hono、Drizzle ORM + D1、Cloudflare R2、Cloudflare Queues、`@octokit/core`、Resend、js-yaml

---

## 既有程式碼（Plan 1 完成）

```
scope3-worker/src/
├── types.ts              # Bindings（已含 RESEND_API_KEY）、Variables、GitHubInstallationPayload
├── db/schema.ts          # tenants、supplierTokens、pullJobs、auditLog
├── db/queries.ts         # insertTenant、getTenant
├── github/app.ts         # createGitHubApp、getInstallationOctokit
├── github/repo.ts        # createTenantRepo
├── handlers/installation.ts  # handleInstallation
├── middleware/github-webhook.ts  # verifyGitHubWebhook(secret)
├── routes/webhook.ts     # POST /webhook
├── routes/health.ts      # GET /health
└── index.ts              # Hono app 入口
```

---

## 新增檔案結構

```
scope3-worker/
├── src/
│   ├── types.ts                     # MODIFY: 加入 FILES (R2Bucket)、SUBMISSION_QUEUE
│   ├── db/
│   │   └── queries.ts               # MODIFY: 加入 supplier token CRUD
│   ├── lib/
│   │   └── tokens.ts                # NEW: token 產生 helper
│   ├── github/
│   │   ├── issue.ts                 # NEW: createSubmissionIssue
│   │   └── config.ts                # NEW: readTenantConfig（讀 config.yml）
│   ├── handlers/
│   │   ├── submission.ts            # NEW: processSubmission（核心）
│   │   ├── config-push.ts           # NEW: handleConfigPush（config.yml 變更）
│   │   └── pull-job.ts              # NEW: executePullJob
│   ├── email/
│   │   └── resend.ts                # NEW: sendOnboardingEmail
│   ├── queue/
│   │   └── consumer.ts              # NEW: Cloudflare Queue handler
│   └── routes/
│       ├── submit.ts                # NEW: GET/POST /submit/:org/:token（Web Form）
│       ├── api-submit.ts            # NEW: POST /api/v1/submit（Push API）
│       └── upload.ts                # NEW: POST /api/v1/upload/:org/:token（R2）
├── tests/
│   ├── db/
│   │   └── supplier-token.test.ts   # NEW
│   ├── github/
│   │   └── issue.test.ts            # NEW
│   └── handlers/
│       ├── submission.test.ts       # NEW
│       └── config-push.test.ts      # NEW
└── wrangler.toml                    # MODIFY: R2 + Queue bindings
```

---

## Task 1: 安裝依賴 + 更新 wrangler.toml

**Files:**
- Modify: `scope3-worker/wrangler.toml`
- Run: `pnpm add`

- [ ] **Step 1: 安裝新套件**

```bash
cd /Users/lightman/yao.care/agent.scope3esg/scope3-worker
pnpm add js-yaml resend
pnpm add -D @types/js-yaml
```

- [ ] **Step 2: 建立 Cloudflare R2 bucket**

```bash
CLOUDFLARE_API_TOKEN=<your-token> pnpm wrangler r2 bucket create scope3-files 2>&1
```

Expected: `Created bucket 'scope3-files'`

- [ ] **Step 3: 建立 Cloudflare Queue**

```bash
CLOUDFLARE_API_TOKEN=<your-token> pnpm wrangler queues create scope3-pull-jobs 2>&1
```

Expected: `Created queue 'scope3-pull-jobs'`

- [ ] **Step 4: 更新 wrangler.toml**

```toml
name = "scope3-worker"
main = "src/index.ts"
compatibility_date = "2024-12-01"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "scope3"
database_id = "b49b85a5-b624-4b4f-bc59-85454aa6077f"

[[r2_buckets]]
binding = "FILES"
bucket_name = "scope3-files"

[[queues.producers]]
binding = "SUBMISSION_QUEUE"
queue = "scope3-pull-jobs"

[[queues.consumers]]
queue = "scope3-pull-jobs"
max_batch_size = 10
max_batch_timeout = 30

[vars]
GITHUB_APP_ID = ""
WORKER_BASE_URL = "https://scope3-worker.lightman-chang.workers.dev"

# Secrets（set via: wrangler secret put <KEY>）:
# GITHUB_APP_PRIVATE_KEY
# GITHUB_WEBHOOK_SECRET
# GITHUB_APP_CLIENT_ID
# GITHUB_APP_CLIENT_SECRET
# RESEND_API_KEY
```

- [ ] **Step 5: 更新 `src/types.ts`，加入新 bindings**

```typescript
// src/types.ts

export interface Bindings {
  DB: D1Database;
  FILES: R2Bucket;
  SUBMISSION_QUEUE: Queue;
  GITHUB_APP_ID: string;
  GITHUB_APP_PRIVATE_KEY: string;
  GITHUB_WEBHOOK_SECRET: string;
  GITHUB_APP_CLIENT_ID: string;
  GITHUB_APP_CLIENT_SECRET: string;
  RESEND_API_KEY: string;
  WORKER_BASE_URL: string;
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

export interface GitHubPushPayload {
  ref: string;
  repository: {
    name: string;
    owner: { login: string };
  };
  commits: Array<{
    added: string[];
    modified: string[];
  }>;
  installation: { id: number };
}

export interface Submission {
  submission_id: string;
  supplier_id: string;
  supplier_name: string;
  scope3_category: number;
  period: string;
  activity_type: string;
  amount: number;
  unit: string;
  evidence_urls: string[];
  submitted_at: string;
  channel: 'form' | 'api' | 'pull';
  emission_factor_id: null;
  calculated_co2e: null;
}

export interface TenantConfig {
  inventory_year: number;
  enabled_categories: number[];
  suppliers: SupplierConfig[];
}

export interface SupplierConfig {
  id: string;
  name: string;
  contact: string;
  pull_api: string | null;
  pull_schedule: string | null;
}

export interface PullJobMessage {
  org: string;
  supplier_id: string;
  api_url: string;
  token: string;
}
```

- [ ] **Step 6: 確認 TypeScript 無誤**

```bash
pnpm tsc --noEmit 2>&1 | head -20
```

Expected: 無錯誤（或只有既有的不相關警告）。

- [ ] **Step 7: Commit**

```bash
cd /Users/lightman/yao.care/agent.scope3esg
git add scope3-worker/wrangler.toml scope3-worker/src/types.ts scope3-worker/package.json scope3-worker/pnpm-lock.yaml
git commit -m "chore: add R2, Queue bindings and Plan 2 dependencies"
```

---

## Task 2: Supplier Token D1 查詢擴充（TDD）

**Files:**
- Modify: `scope3-worker/src/db/queries.ts`
- Create: `scope3-worker/tests/db/supplier-token.test.ts`

- [ ] **Step 1: 建立失敗的測試**

```typescript
// tests/db/supplier-token.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import { applyMigrations } from '../helpers/migrate';
import { insertSupplierToken, getSupplierToken, listSupplierTokensByOrg } from '../../src/db/queries';

describe('supplier token queries', () => {
  beforeAll(async () => {
    await applyMigrations(env.DB);
  });

  it('inserts and retrieves a supplier token', async () => {
    await insertSupplierToken(env.DB, {
      token:      'tok_abc123',
      org:        'acme-corp',
      supplierId: 'SUP001',
      expiresAt:  '2027-01-01T00:00:00Z',
    });
    const row = await getSupplierToken(env.DB, 'tok_abc123');
    expect(row?.org).toBe('acme-corp');
    expect(row?.supplierId).toBe('SUP001');
  });

  it('returns null for unknown token', async () => {
    const row = await getSupplierToken(env.DB, 'unknown');
    expect(row).toBeNull();
  });

  it('lists tokens by org', async () => {
    await insertSupplierToken(env.DB, {
      token:      'tok_xyz999',
      org:        'acme-corp',
      supplierId: 'SUP002',
      expiresAt:  '2027-01-01T00:00:00Z',
    });
    const rows = await listSupplierTokensByOrg(env.DB, 'acme-corp');
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.map(r => r.supplierId)).toContain('SUP001');
    expect(rows.map(r => r.supplierId)).toContain('SUP002');
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

```bash
cd /Users/lightman/yao.care/agent.scope3esg/scope3-worker
pnpm vitest run tests/db/supplier-token.test.ts 2>&1 | tail -10
```

Expected: FAIL — `insertSupplierToken is not a function`

- [ ] **Step 3: 擴充 `src/db/queries.ts`**

在現有 `insertTenant` / `getTenant` 之後加入：

```typescript
// 在 src/db/queries.ts 現有內容之後加入：

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
```

也需要在檔案頂端 import `supplierTokens`：

```typescript
import { tenants, supplierTokens } from './schema';
```

- [ ] **Step 4: 執行測試確認通過**

```bash
pnpm vitest run tests/db/supplier-token.test.ts 2>&1 | tail -10
```

Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/lightman/yao.care/agent.scope3esg
git add scope3-worker/src/db/queries.ts scope3-worker/tests/db/supplier-token.test.ts
git commit -m "feat: add supplier token D1 queries"
```

---

## Task 3: Token 產生 Helper

**Files:**
- Create: `scope3-worker/src/lib/tokens.ts`

- [ ] **Step 1: 建立 token helper**

```typescript
// src/lib/tokens.ts

export function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return 'stok_' + Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export function generateFormUrl(baseUrl: string, org: string, token: string): string {
  return `${baseUrl}/submit/${org}/${token}`;
}

export function tokenExpiresAt(daysFromNow = 365): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString();
}
```

- [ ] **Step 2: 確認 TypeScript 無誤**

```bash
cd /Users/lightman/yao.care/agent.scope3esg/scope3-worker
pnpm tsc --noEmit 2>&1 | grep "tokens.ts" || echo "OK"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
cd /Users/lightman/yao.care/agent.scope3esg
git add scope3-worker/src/lib/tokens.ts
git commit -m "feat: add supplier token generation helpers"
```

---

## Task 4: GitHub Issue 建立（TDD）

**Files:**
- Create: `scope3-worker/src/github/issue.ts`
- Create: `scope3-worker/tests/github/issue.test.ts`

- [ ] **Step 1: 建立失敗的測試**

```typescript
// tests/github/issue.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSubmissionIssue } from '../../src/github/issue';
import type { Submission } from '../../src/types';

const mockOctokit = { request: vi.fn() };

const submission: Submission = {
  submission_id:    'sub-uuid-001',
  supplier_id:      'SUP001',
  supplier_name:    '台灣鋼鐵股份有限公司',
  scope3_category:  1,
  period:           '2025-Q1',
  activity_type:    'electricity',
  amount:           10000,
  unit:             'kWh',
  evidence_urls:    [],
  submitted_at:     '2025-05-25T08:00:00Z',
  channel:          'form',
  emission_factor_id: null,
  calculated_co2e:    null,
};

describe('createSubmissionIssue', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates issue with correct title, labels, and JSON body', async () => {
    mockOctokit.request.mockResolvedValue({ data: { number: 42 } });

    const issueNumber = await createSubmissionIssue(mockOctokit as any, 'acme-corp', submission);

    expect(issueNumber).toBe(42);
    expect(mockOctokit.request).toHaveBeenCalledWith(
      'POST /repos/{owner}/{repo}/issues',
      expect.objectContaining({
        owner: 'acme-corp',
        repo:  'scope3-inventory',
        labels: expect.arrayContaining(['status:submitted', 'cat:1']),
      }),
    );

    const callArgs = mockOctokit.request.mock.calls[0][1];
    expect(callArgs.body).toContain('sub-uuid-001');
    expect(callArgs.body).toContain('台灣鋼鐵股份有限公司');
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

```bash
cd /Users/lightman/yao.care/agent.scope3esg/scope3-worker
pnpm vitest run --config vitest.middleware.config.ts tests/github/issue.test.ts 2>&1 | tail -10
```

Expected: FAIL — `createSubmissionIssue is not a function`

- [ ] **Step 3: 實作 `src/github/issue.ts`**

```typescript
// src/github/issue.ts
import type { Octokit } from '@octokit/core';
import type { Submission } from '../types';

export async function createSubmissionIssue(
  octokit: Octokit,
  org: string,
  submission: Submission,
): Promise<number> {
  const title = `[${submission.supplier_name}] Scope 3 Cat.${submission.scope3_category} — ${submission.period}`;

  const body = `## 供應商碳排資料提交

| 欄位 | 值 |
|------|-----|
| 供應商 | ${submission.supplier_name} |
| 類別 | Scope 3 Category ${submission.scope3_category} |
| 期間 | ${submission.period} |
| 活動類型 | ${submission.activity_type} |
| 數量 | ${submission.amount} ${submission.unit} |
| 管道 | ${submission.channel} |
| 提交時間 | ${submission.submitted_at} |

${submission.evidence_urls.length > 0
  ? '## 佐證文件\n' + submission.evidence_urls.map(u => `- ${u}`).join('\n')
  : ''}

<!-- scope3-data:
${JSON.stringify(submission, null, 2)}
-->`;

  const { data } = await octokit.request('POST /repos/{owner}/{repo}/issues', {
    owner:  org,
    repo:   'scope3-inventory',
    title,
    body,
    labels: ['status:submitted', `cat:${submission.scope3_category}`],
  });

  return data.number;
}
```

- [ ] **Step 4: 執行測試確認通過**

```bash
pnpm vitest run --config vitest.middleware.config.ts tests/github/issue.test.ts 2>&1 | tail -10
```

Expected: PASS

- [ ] **Step 5: 更新 `vitest.middleware.config.ts` 的 include**

確認 `tests/github/**/*.test.ts` 已在 include 中（Plan 1 的 Task 7 已加入，若無則加入）：

```typescript
include: ['tests/middleware/**/*.test.ts', 'tests/github/**/*.test.ts'],
```

- [ ] **Step 6: Commit**

```bash
cd /Users/lightman/yao.care/agent.scope3esg
git add scope3-worker/src/github/issue.ts scope3-worker/tests/github/issue.test.ts scope3-worker/vitest.middleware.config.ts
git commit -m "feat: add GitHub Issue creation for Scope 3 submissions"
```

---

## Task 5: 核心 Submission 處理器（TDD）

**Files:**
- Create: `scope3-worker/src/handlers/submission.ts`
- Create: `scope3-worker/tests/handlers/submission.test.ts`

- [ ] **Step 1: 建立失敗的測試**

```typescript
// tests/handlers/submission.test.ts
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import { applyMigrations } from '../helpers/migrate';
import { insertSupplierToken } from '../../src/db/queries';
import { processSubmission } from '../../src/handlers/submission';

vi.mock('../../src/github/app', () => ({
  getInstallationOctokit: vi.fn().mockResolvedValue({ request: vi.fn() }),
}));

vi.mock('../../src/github/issue', () => ({
  createSubmissionIssue: vi.fn().mockResolvedValue(99),
}));

vi.mock('../../src/db/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/db/queries')>();
  return {
    ...actual,
    getTenant: vi.fn().mockResolvedValue({ installationId: 1, org: 'acme-corp' }),
  };
});

describe('processSubmission', () => {
  beforeAll(async () => {
    await applyMigrations(env.DB);
    await insertSupplierToken(env.DB, {
      token:      'tok_valid',
      org:        'acme-corp',
      supplierId: 'SUP001',
      expiresAt:  '2099-01-01T00:00:00Z',
    });
  });

  it('returns issue number on valid submission', async () => {
    const result = await processSubmission(env as any, {
      org:           'acme-corp',
      supplierToken: 'tok_valid',
      data: {
        scope3_category: 1,
        period:          '2025-Q1',
        activity_type:   'electricity',
        amount:          10000,
        unit:            'kWh',
        evidence_urls:   [],
      },
      channel: 'api',
    });
    expect(result.success).toBe(true);
    expect(result.issueNumber).toBe(99);
  });

  it('returns error for invalid token', async () => {
    const result = await processSubmission(env as any, {
      org:           'acme-corp',
      supplierToken: 'tok_bad',
      data: {
        scope3_category: 1,
        period:          '2025-Q1',
        activity_type:   'electricity',
        amount:          100,
        unit:            'kWh',
        evidence_urls:   [],
      },
      channel: 'api',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/invalid token/i);
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

```bash
cd /Users/lightman/yao.care/agent.scope3esg/scope3-worker
pnpm vitest run tests/handlers/submission.test.ts 2>&1 | tail -10
```

Expected: FAIL — `processSubmission is not a function`

- [ ] **Step 3: 實作 `src/handlers/submission.ts`**

```typescript
// src/handlers/submission.ts
import { getSupplierToken } from '../db/queries';
import { getTenant } from '../db/queries';
import { getInstallationOctokit } from '../github/app';
import { createSubmissionIssue } from '../github/issue';
import type { Bindings, Submission } from '../types';

interface SubmissionInput {
  org:           string;
  supplierToken: string;
  data: {
    scope3_category: number;
    period:          string;
    activity_type:   string;
    amount:          number;
    unit:            string;
    evidence_urls:   string[];
  };
  channel: 'form' | 'api' | 'pull';
}

interface SubmissionResult {
  success:     boolean;
  issueNumber?: number;
  error?:      string;
}

export async function processSubmission(
  env: Bindings,
  input: SubmissionInput,
): Promise<SubmissionResult> {
  const tokenRow = await getSupplierToken(env.DB, input.supplierToken);
  if (!tokenRow || tokenRow.org !== input.org) {
    return { success: false, error: 'Invalid token' };
  }

  if (new Date(tokenRow.expiresAt) < new Date()) {
    return { success: false, error: 'Token expired' };
  }

  const tenant = await getTenant(env.DB, 0);
  // Look up tenant by org
  const tenantRow = await (async () => {
    const db = env.DB;
    const result = await db
      .prepare('SELECT * FROM tenants WHERE org = ? LIMIT 1')
      .bind(input.org)
      .first<{ installation_id: number; org: string }>();
    return result;
  })();

  if (!tenantRow) {
    return { success: false, error: 'Tenant not found' };
  }

  const octokit = await getInstallationOctokit(env, tenantRow.installation_id);

  const submission: Submission = {
    submission_id:      crypto.randomUUID(),
    supplier_id:        tokenRow.supplierId,
    supplier_name:      tokenRow.supplierId,
    scope3_category:    input.data.scope3_category,
    period:             input.data.period,
    activity_type:      input.data.activity_type,
    amount:             input.data.amount,
    unit:               input.data.unit,
    evidence_urls:      input.data.evidence_urls,
    submitted_at:       new Date().toISOString(),
    channel:            input.channel,
    emission_factor_id: null,
    calculated_co2e:    null,
  };

  const issueNumber = await createSubmissionIssue(octokit, input.org, submission);
  return { success: true, issueNumber };
}
```

- [ ] **Step 4: 執行測試確認通過**

```bash
pnpm vitest run tests/handlers/submission.test.ts 2>&1 | tail -10
```

Expected: 2 tests PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/lightman/yao.care/agent.scope3esg
git add scope3-worker/src/handlers/submission.ts scope3-worker/tests/handlers/submission.test.ts
git commit -m "feat: add core submission handler"
```

---

## Task 6: R2 檔案上傳路由

**Files:**
- Create: `scope3-worker/src/routes/upload.ts`

- [ ] **Step 1: 建立 upload 路由**

```typescript
// src/routes/upload.ts
import { Hono } from 'hono';
import type { Bindings, Variables } from '../types';
import { getSupplierToken } from '../db/queries';

const upload = new Hono<{ Bindings: Bindings; Variables: Variables }>();

upload.post('/:org/:token', async (c) => {
  const { org, token } = c.req.param();

  const tokenRow = await getSupplierToken(c.env.DB, token);
  if (!tokenRow || tokenRow.org !== org) {
    return c.json({ error: 'Invalid token' }, 401);
  }

  const formData = await c.req.formData();
  const file = formData.get('file') as File | null;
  if (!file) {
    return c.json({ error: 'No file provided' }, 400);
  }

  if (file.size > 10 * 1024 * 1024) {
    return c.json({ error: 'File too large (max 10MB)' }, 413);
  }

  const ext = file.name.split('.').pop() ?? 'bin';
  const key = `${org}/${tokenRow.supplierId}/${crypto.randomUUID()}.${ext}`;

  await c.env.FILES.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
    customMetadata: {
      originalName: file.name,
      supplierId:   tokenRow.supplierId,
      org,
    },
  });

  const url = `${c.env.WORKER_BASE_URL}/files/${key}`;
  return c.json({ url }, 201);
});

export default upload;
```

- [ ] **Step 2: 在 `src/index.ts` 掛載 upload 路由**

在 `src/index.ts` 加入：

```typescript
import uploadRoute from './routes/upload';

// 在 app.route('/health', healthRoute); 之後加入：
app.route('/api/v1/upload', uploadRoute);
```

- [ ] **Step 3: 確認 TypeScript 無誤**

```bash
cd /Users/lightman/yao.care/agent.scope3esg/scope3-worker
pnpm tsc --noEmit 2>&1 | grep "upload.ts" || echo "OK"
```

Expected: `OK`

- [ ] **Step 4: Commit**

```bash
cd /Users/lightman/yao.care/agent.scope3esg
git add scope3-worker/src/routes/upload.ts scope3-worker/src/index.ts
git commit -m "feat: add R2 file upload route"
```

---

## Task 7: Web Form 路由

**Files:**
- Create: `scope3-worker/src/routes/submit.ts`

- [ ] **Step 1: 建立 submit 路由（含 HTML form）**

```typescript
// src/routes/submit.ts
import { Hono } from 'hono';
import type { Bindings, Variables } from '../types';
import { getSupplierToken } from '../db/queries';
import { processSubmission } from '../handlers/submission';

const submit = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function formHtml(org: string, token: string, supplierId: string): string {
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Scope 3 碳排資料提交</title>
<style>
  body { font-family: sans-serif; max-width: 640px; margin: 40px auto; padding: 0 20px; }
  h1 { font-size: 1.4rem; color: #1a1a1a; }
  label { display: block; margin: 16px 0 4px; font-weight: bold; font-size: .9rem; }
  input, select { width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; }
  .row { display: flex; gap: 12px; }
  .row > * { flex: 1; }
  button { margin-top: 24px; padding: 12px 32px; background: #0070f3; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 1rem; }
  .supplier { color: #555; font-size: .9rem; margin-bottom: 24px; }
</style>
</head>
<body>
<h1>Scope 3 碳排資料提交</h1>
<p class="supplier">供應商：<strong>${supplierId}</strong></p>
<form method="POST" enctype="multipart/form-data">
  <label>盤點類別 (Scope 3 Category)</label>
  <select name="scope3_category" required>
    ${Array.from({length:15},(_,i)=>`<option value="${i+1}">Category ${i+1}</option>`).join('')}
  </select>

  <label>期間（例：2025-Q1）</label>
  <input name="period" placeholder="2025-Q1" required pattern="\\d{4}-Q[1-4]">

  <label>活動類型</label>
  <select name="activity_type" required>
    <option value="electricity">電力 (Electricity)</option>
    <option value="natural_gas">天然氣 (Natural Gas)</option>
    <option value="diesel">柴油 (Diesel)</option>
    <option value="water">用水 (Water)</option>
    <option value="waste">廢棄物 (Waste)</option>
    <option value="product">產品 (Product)</option>
    <option value="transport">運輸 (Transport)</option>
  </select>

  <div class="row">
    <div>
      <label>數量</label>
      <input name="amount" type="number" step="any" required>
    </div>
    <div>
      <label>單位</label>
      <select name="unit" required>
        <option value="kWh">kWh</option>
        <option value="Nm3">Nm3</option>
        <option value="L">公升 (L)</option>
        <option value="ton">公噸 (ton)</option>
        <option value="kg">公斤 (kg)</option>
        <option value="pcs">件 (pcs)</option>
        <option value="km">公里 (km)</option>
      </select>
    </div>
  </div>

  <label>佐證文件（可多選，最大 10MB/檔）</label>
  <input name="files" type="file" multiple accept=".pdf,.xlsx,.csv,.jpg,.png">

  <button type="submit">提交資料</button>
</form>
</body>
</html>`;
}

function successHtml(): string {
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head><meta charset="UTF-8"><title>提交成功</title>
<style>body{font-family:sans-serif;max-width:480px;margin:80px auto;text-align:center;}
h1{color:#0e8a16;}p{color:#555;}</style></head>
<body><h1>✅ 提交成功</h1>
<p>資料已收到，審查人員將在 5 個工作天內完成審核。</p>
<p>感謝您的配合。</p></body></html>`;
}

// GET — serve the form
submit.get('/:org/:token', async (c) => {
  const { org, token } = c.req.param();
  const tokenRow = await getSupplierToken(c.env.DB, token);
  if (!tokenRow || tokenRow.org !== org) {
    return c.text('無效的連結', 401);
  }
  return c.html(formHtml(org, token, tokenRow.supplierId));
});

// POST — process form submission
submit.post('/:org/:token', async (c) => {
  const { org, token } = c.req.param();

  const formData = await c.req.formData();

  // Upload files to R2 first
  const evidenceUrls: string[] = [];
  const files = formData.getAll('files') as File[];
  for (const file of files) {
    if (file.size === 0) continue;
    const ext = file.name.split('.').pop() ?? 'bin';
    const key = `${org}/${crypto.randomUUID()}.${ext}`;
    await c.env.FILES.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type },
    });
    evidenceUrls.push(`${c.env.WORKER_BASE_URL}/files/${key}`);
  }

  const result = await processSubmission(c.env, {
    org,
    supplierToken: token,
    data: {
      scope3_category: Number(formData.get('scope3_category')),
      period:          String(formData.get('period')),
      activity_type:   String(formData.get('activity_type')),
      amount:          Number(formData.get('amount')),
      unit:            String(formData.get('unit')),
      evidence_urls:   evidenceUrls,
    },
    channel: 'form',
  });

  if (!result.success) {
    return c.text(result.error ?? '提交失敗', 400);
  }

  return c.html(successHtml());
});

export default submit;
```

- [ ] **Step 2: 在 `src/index.ts` 掛載 submit 路由**

```typescript
import submitRoute from './routes/submit';

// 在 app.route('/api/v1/upload', uploadRoute); 之後加入：
app.route('/submit', submitRoute);
```

- [ ] **Step 3: 確認 TypeScript 無誤**

```bash
pnpm tsc --noEmit 2>&1 | grep "submit.ts" || echo "OK"
```

Expected: `OK`

- [ ] **Step 4: Commit**

```bash
cd /Users/lightman/yao.care/agent.scope3esg
git add scope3-worker/src/routes/submit.ts scope3-worker/src/index.ts
git commit -m "feat: add supplier web form route"
```

---

## Task 8: Push API 路由（TDD）

**Files:**
- Create: `scope3-worker/src/routes/api-submit.ts`

- [ ] **Step 1: 建立失敗的測試**

```typescript
// tests/routes/api-submit.test.ts
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import { applyMigrations } from '../helpers/migrate';
import { insertSupplierToken } from '../../src/db/queries';
import app from '../../src/index';

vi.mock('../../src/handlers/submission', () => ({
  processSubmission: vi.fn().mockResolvedValue({ success: true, issueNumber: 7 }),
}));

describe('POST /api/v1/submit', () => {
  beforeAll(async () => {
    await applyMigrations(env.DB);
    await insertSupplierToken(env.DB, {
      token:      'stok_apitest',
      org:        'acme-corp',
      supplierId: 'SUP001',
      expiresAt:  '2099-01-01T00:00:00Z',
    });
  });

  it('returns 201 with issue number on valid request', async () => {
    const res = await app.request('/api/v1/submit', {
      method:  'POST',
      headers: {
        'Authorization': 'Bearer stok_apitest',
        'Content-Type':  'application/json',
        'X-Scope3-Org':  'acme-corp',
      },
      body: JSON.stringify({
        scope3_category: 1,
        period:          '2025-Q1',
        activity_type:   'electricity',
        amount:          5000,
        unit:            'kWh',
        evidence_urls:   [],
      }),
    }, env as any);

    expect(res.status).toBe(201);
    const body = await res.json<{ issueNumber: number }>();
    expect(body.issueNumber).toBe(7);
  });

  it('returns 401 when Authorization header is missing', async () => {
    const res = await app.request('/api/v1/submit', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-Scope3-Org': 'acme-corp' },
      body:    JSON.stringify({ scope3_category: 1, period: '2025-Q1', activity_type: 'x', amount: 1, unit: 'kg', evidence_urls: [] }),
    }, env as any);
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

```bash
cd /Users/lightman/yao.care/agent.scope3esg/scope3-worker
pnpm vitest run tests/routes/api-submit.test.ts 2>&1 | tail -10
```

Expected: FAIL（路由尚未建立）

確認 `vitest.config.ts`（Cloudflare pool）的 include 涵蓋 `tests/routes/**`，若否加入：

```typescript
// vitest.config.ts 的 test 區塊加入：
include: ['tests/db/**/*.test.ts', 'tests/handlers/**/*.test.ts', 'tests/routes/**/*.test.ts'],
```

- [ ] **Step 3: 建立 `src/routes/api-submit.ts`**

```typescript
// src/routes/api-submit.ts
import { Hono } from 'hono';
import type { Bindings, Variables } from '../types';
import { processSubmission } from '../handlers/submission';

const apiSubmit = new Hono<{ Bindings: Bindings; Variables: Variables }>();

apiSubmit.post('/', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing Authorization header' }, 401);
  }
  const token = authHeader.slice(7);
  const org   = c.req.header('X-Scope3-Org') ?? '';
  if (!org) return c.json({ error: 'Missing X-Scope3-Org header' }, 400);

  const body = await c.req.json<{
    scope3_category: number;
    period:          string;
    activity_type:   string;
    amount:          number;
    unit:            string;
    evidence_urls:   string[];
  }>();

  const result = await processSubmission(c.env, {
    org,
    supplierToken: token,
    data:          body,
    channel:       'api',
  });

  if (!result.success) {
    return c.json({ error: result.error }, 400);
  }

  return c.json({ issueNumber: result.issueNumber }, 201);
});

export default apiSubmit;
```

- [ ] **Step 4: 在 `src/index.ts` 掛載**

```typescript
import apiSubmitRoute from './routes/api-submit';

// 加入：
app.route('/api/v1/submit', apiSubmitRoute);
```

- [ ] **Step 5: 執行測試確認通過**

```bash
pnpm vitest run tests/routes/api-submit.test.ts 2>&1 | tail -10
```

Expected: 2 tests PASS

- [ ] **Step 6: Commit**

```bash
cd /Users/lightman/yao.care/agent.scope3esg
git add scope3-worker/src/routes/api-submit.ts scope3-worker/src/index.ts scope3-worker/vitest.config.ts
git commit -m "feat: add Push API route for supplier data submission"
```

---

## Task 9: Resend Email

**Files:**
- Create: `scope3-worker/src/email/resend.ts`

- [ ] **Step 1: 建立 `src/email/resend.ts`**

```typescript
// src/email/resend.ts
import { Resend } from 'resend';

interface OnboardingEmailInput {
  apiKey:       string;
  to:           string;
  supplierName: string;
  orgName:      string;
  formUrl:      string;
  deadline?:    string;
}

export async function sendOnboardingEmail(input: OnboardingEmailInput): Promise<void> {
  const resend = new Resend(input.apiKey);

  await resend.emails.send({
    from:    'Scope3 盤點系統 <noreply@scope3.yao.care>',
    to:      input.to,
    subject: `【邀請】${input.orgName} Scope 3 碳排資料提交`,
    html: `
<h2>您好，${input.supplierName}</h2>
<p>${input.orgName} 邀請您透過以下連結提交 Scope 3 碳排資料：</p>
<p><a href="${input.formUrl}" style="display:inline-block;padding:12px 24px;background:#0070f3;color:#fff;text-decoration:none;border-radius:4px;">開始填寫資料</a></p>
<p>連結網址：<a href="${input.formUrl}">${input.formUrl}</a></p>
${input.deadline ? `<p>請於 <strong>${input.deadline}</strong> 前完成提交。</p>` : ''}
<hr>
<p style="color:#888;font-size:.85rem;">如有疑問，請聯繫 ESG 管理員。此連結為您專屬，請勿分享給他人。</p>
`,
  });
}
```

- [ ] **Step 2: 確認 TypeScript 無誤**

```bash
cd /Users/lightman/yao.care/agent.scope3esg/scope3-worker
pnpm tsc --noEmit 2>&1 | grep "resend.ts" || echo "OK"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
cd /Users/lightman/yao.care/agent.scope3esg
git add scope3-worker/src/email/resend.ts
git commit -m "feat: add Resend onboarding email"
```

---

## Task 10: Config Push Handler（TDD）

當 ESG Manager 推送 `config.yml` 變更時，Worker 讀取新供應商清單 → 為尚未有 token 的供應商產生 token → 存入 D1 → 寄送 onboarding email。

**Files:**
- Create: `scope3-worker/src/github/config.ts`
- Create: `scope3-worker/src/handlers/config-push.ts`
- Create: `scope3-worker/tests/handlers/config-push.test.ts`
- Modify: `scope3-worker/src/routes/webhook.ts`

- [ ] **Step 1: 建立 `src/github/config.ts`**

```typescript
// src/github/config.ts
import type { Octokit } from '@octokit/core';
import { load as yamlLoad } from 'js-yaml';
import type { TenantConfig } from '../types';

export async function readTenantConfig(octokit: Octokit, org: string): Promise<TenantConfig | null> {
  try {
    const { data } = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
      owner: org,
      repo:  'scope3-inventory',
      path:  'config.yml',
    });
    if (!('content' in data)) return null;
    const yaml = atob(data.content.replace(/\n/g, ''));
    return yamlLoad(yaml) as TenantConfig;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: 建立失敗的測試**

```typescript
// tests/handlers/config-push.test.ts
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import { applyMigrations } from '../helpers/migrate';
import { handleConfigPush } from '../../src/handlers/config-push';
import type { GitHubPushPayload } from '../../src/types';

vi.mock('../../src/github/app', () => ({
  getInstallationOctokit: vi.fn().mockResolvedValue({ request: vi.fn() }),
}));

vi.mock('../../src/github/config', () => ({
  readTenantConfig: vi.fn().mockResolvedValue({
    inventory_year:      2025,
    enabled_categories:  [1, 4],
    suppliers: [
      { id: 'SUP001', name: '台鋼', contact: 'esg@twsteel.com', pull_api: null, pull_schedule: null },
    ],
  }),
}));

vi.mock('../../src/email/resend', () => ({
  sendOnboardingEmail: vi.fn().mockResolvedValue(undefined),
}));

const pushPayload: GitHubPushPayload = {
  ref:        'refs/heads/main',
  repository: { name: 'scope3-inventory', owner: { login: 'acme-corp' } },
  commits:    [{ added: [], modified: ['config.yml'] }],
  installation: { id: 1 },
};

describe('handleConfigPush', () => {
  beforeAll(async () => {
    await applyMigrations(env.DB);
    // Insert tenant so the handler can find the installation
    await env.DB.prepare(
      "INSERT INTO tenants VALUES (1, 'acme-corp', 'R_test', ?)"
    ).bind(new Date().toISOString()).run();
  });

  it('generates tokens for new suppliers and sends emails', async () => {
    const { sendOnboardingEmail } = await import('../../src/email/resend');
    await handleConfigPush(env as any, pushPayload);

    const token = await env.DB
      .prepare("SELECT * FROM supplier_tokens WHERE org = 'acme-corp' AND supplier_id = 'SUP001'")
      .first();

    expect(token).not.toBeNull();
    expect(sendOnboardingEmail).toHaveBeenCalledOnce();
  });

  it('does not duplicate tokens for existing suppliers', async () => {
    const { sendOnboardingEmail } = await import('../../src/email/resend');
    vi.mocked(sendOnboardingEmail).mockClear();

    await handleConfigPush(env as any, pushPayload);

    const tokens = await env.DB
      .prepare("SELECT * FROM supplier_tokens WHERE org = 'acme-corp' AND supplier_id = 'SUP001'")
      .all();

    // Still only 1 token for SUP001
    expect(tokens.results.length).toBe(1);
    expect(sendOnboardingEmail).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: 執行測試確認失敗**

```bash
cd /Users/lightman/yao.care/agent.scope3esg/scope3-worker
pnpm vitest run tests/handlers/config-push.test.ts 2>&1 | tail -10
```

Expected: FAIL — `handleConfigPush is not a function`

- [ ] **Step 4: 實作 `src/handlers/config-push.ts`**

```typescript
// src/handlers/config-push.ts
import { getInstallationOctokit } from '../github/app';
import { readTenantConfig } from '../github/config';
import { listSupplierTokensByOrg, insertSupplierToken } from '../db/queries';
import { sendOnboardingEmail } from '../email/resend';
import { generateToken, generateFormUrl, tokenExpiresAt } from '../lib/tokens';
import type { Bindings, GitHubPushPayload } from '../types';

export async function handleConfigPush(
  env: Bindings,
  payload: GitHubPushPayload,
): Promise<void> {
  const modifiedFiles = payload.commits.flatMap(c => [...c.added, ...c.modified]);
  if (!modifiedFiles.includes('config.yml')) return;

  const org   = payload.repository.owner.login;
  const instId = payload.installation.id;

  const octokit = await getInstallationOctokit(env, instId);
  const config  = await readTenantConfig(octokit, org);
  if (!config) return;

  const existingTokens = await listSupplierTokensByOrg(env.DB, org);
  const existingSupplierIds = new Set(existingTokens.map(t => t.supplierId));

  for (const supplier of config.suppliers) {
    if (existingSupplierIds.has(supplier.id)) continue;

    const token  = generateToken();
    const formUrl = generateFormUrl(env.WORKER_BASE_URL, org, token);

    await insertSupplierToken(env.DB, {
      token,
      org,
      supplierId: supplier.id,
      expiresAt:  tokenExpiresAt(365),
    });

    if (supplier.contact && env.RESEND_API_KEY) {
      await sendOnboardingEmail({
        apiKey:       env.RESEND_API_KEY,
        to:           supplier.contact,
        supplierName: supplier.name,
        orgName:      org,
        formUrl,
      });
    }
  }
}
```

- [ ] **Step 5: 在 `src/routes/webhook.ts` 加入 `push` 事件處理**

在 `switch (event)` 加入：

```typescript
import { handleConfigPush } from '../handlers/config-push';

// 在 case 'installation': ... 之後加入：
case 'push':
  await handleConfigPush(c.env, body);
  break;
```

Also add the `push` event to the GitHub App's subscribed events (manual step in GitHub App settings).

- [ ] **Step 6: 執行測試確認通過**

```bash
pnpm vitest run tests/handlers/config-push.test.ts 2>&1 | tail -10
```

Expected: 2 tests PASS

- [ ] **Step 7: Commit**

```bash
cd /Users/lightman/yao.care/agent.scope3esg
git add scope3-worker/src/github/config.ts \
        scope3-worker/src/handlers/config-push.ts \
        scope3-worker/src/routes/webhook.ts \
        scope3-worker/tests/handlers/config-push.test.ts
git commit -m "feat: handle config.yml push → generate supplier tokens and send emails"
```

---

## Task 11: Cloudflare Queue Consumer（Pull Job）

**Files:**
- Create: `scope3-worker/src/queue/consumer.ts`
- Create: `scope3-worker/src/handlers/pull-job.ts`
- Modify: `scope3-worker/src/index.ts`

- [ ] **Step 1: 建立 `src/handlers/pull-job.ts`**

```typescript
// src/handlers/pull-job.ts
import { processSubmission } from './submission';
import type { Bindings, PullJobMessage } from '../types';

export async function executePullJob(
  env: Bindings,
  job: PullJobMessage,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(job.api_url, {
      headers: { Authorization: `Bearer ${job.token}` },
    });
  } catch (err) {
    console.error(`[pull-job] fetch failed for ${job.org}/${job.supplier_id}:`, err);
    return;
  }

  if (!response.ok) {
    console.error(`[pull-job] API returned ${response.status} for ${job.org}/${job.supplier_id}`);
    return;
  }

  const data = await response.json<{
    scope3_category: number;
    period:          string;
    activity_type:   string;
    amount:          number;
    unit:            string;
  }>();

  await processSubmission(env, {
    org:           job.org,
    supplierToken: job.token,
    data: { ...data, evidence_urls: [] },
    channel:       'pull',
  });
}
```

- [ ] **Step 2: 建立 `src/queue/consumer.ts`**

```typescript
// src/queue/consumer.ts
import { executePullJob } from '../handlers/pull-job';
import type { Bindings, PullJobMessage } from '../types';

export async function handleQueue(
  batch: MessageBatch<PullJobMessage>,
  env: Bindings,
): Promise<void> {
  for (const msg of batch.messages) {
    try {
      await executePullJob(env, msg.body);
      msg.ack();
    } catch (err) {
      console.error('[queue] job failed:', err);
      msg.retry();
    }
  }
}
```

- [ ] **Step 3: 更新 `src/index.ts`，export queue handler**

```typescript
// src/index.ts 完整版
import { Hono } from 'hono';
import type { Bindings, Variables, PullJobMessage } from './types';
import webhookRoute   from './routes/webhook';
import healthRoute    from './routes/health';
import uploadRoute    from './routes/upload';
import submitRoute    from './routes/submit';
import apiSubmitRoute from './routes/api-submit';
import { handleQueue } from './queue/consumer';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.route('/webhook',      webhookRoute);
app.route('/health',       healthRoute);
app.route('/api/v1/upload', uploadRoute);
app.route('/api/v1/submit', apiSubmitRoute);
app.route('/submit',       submitRoute);

export default {
  fetch:  app.fetch,
  queue:  handleQueue,
} satisfies ExportedHandler<Bindings>;
```

- [ ] **Step 4: 確認 TypeScript 無誤**

```bash
cd /Users/lightman/yao.care/agent.scope3esg/scope3-worker
pnpm tsc --noEmit 2>&1 | head -20
```

Expected: 無錯誤。若有 `MessageBatch` 型別找不到，確認 `@cloudflare/workers-types` 版本支援 Queues（v4+）。

- [ ] **Step 5: 執行全套測試確認綠燈**

```bash
pnpm vitest run 2>&1 | tail -8
pnpm vitest run --config vitest.middleware.config.ts 2>&1 | tail -8
```

Expected: 全部 PASS

- [ ] **Step 6: Push 並觸發部署**

```bash
cd /Users/lightman/yao.care/agent.scope3esg
git add scope3-worker/src/queue/consumer.ts \
        scope3-worker/src/handlers/pull-job.ts \
        scope3-worker/src/index.ts
git commit -m "feat: add Cloudflare Queue consumer for pull jobs"
git push
```

Expected: GitHub Actions 自動部署，`GET /health` 回傳 `{"status":"ok","version":"1.0.0"}`

---

## 驗收標準

Plan 2 完成時，以下全部成立：

- [ ] 全套測試通過（Cloudflare pool + Node pool）
- [ ] `GET /submit/{org}/{token}` 回傳 HTML form
- [ ] `POST /api/v1/submit`（有效 Bearer token）回傳 `{"issueNumber": N}`
- [ ] `POST /api/v1/upload/{org}/{token}` 回傳 R2 file URL
- [ ] ESG Manager push `config.yml` → D1 新增 supplier token，Resend 寄出 email
- [ ] Worker 已部署至 Cloudflare，`/health` 正常

---

## 接下來

Plan 3 將建立：
- GitHub Actions `validate.yml`（提交驗證）
- GitHub Actions `calculate.yml`（排放量計算）
- 排放係數資料庫 `data/emission-factors.json`
- `data/submissions.json` 彙整

Plan 4 將建立：
- GitHub Pages 儀表板
- Excel / PDF 報告輸出
