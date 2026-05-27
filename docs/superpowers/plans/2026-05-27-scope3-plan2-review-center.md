# Manager 工作台 Plan 2：審核中心 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 ESG Manager 在 Worker 網頁 `/admin/:org/review` 看待審清單（提交＋撤回 PR）、單筆詳情與佐證、validate 狀態燈，並一鍵核定（Worker 代 merge PR）或退件（加 `status:revision` label＋留退件理由），全程不必碰 GitHub。

**Architecture:** 在 `src/github/pr.ts` 擴充 `OpenPR`（帶 `head.sha`＋`labels`）並新增 6 個 helper（讀：`getFileOnBranch`、`getPullChecks`；寫：`mergePullRequest`、`addLabelToPR`、`commentOnPR`；`removeLabelFromPR` 留待 Plan 3）。在 `src/routes/admin-api.ts` 新增 `review/list`（待審清單＋詳情＋狀態）、`review/:pr/approve`（merge→觸發 calculate）、`review/:pr/reject`（label＋留言）三端點。新增 `src/admin/review-page.ts` 審核中心頁面，並在 `src/routes/admin.ts` 註冊 `GET /:org/review`（session 保護），導覽列 active=review。

**Tech Stack:** TypeScript、Hono、Cloudflare Workers、Vitest（兩 pool）、pnpm。

**對應 spec：** `docs/superpowers/specs/2026-05-27-scope3-manager-workbench-design.md` 區塊 2。

**前置與權限（實作前確認，但不阻擋）：**
- **Pull requests: write**（merge PR）— branch/PR 重構時已授予，現有 `openPullRequest`／`closePullRequest` 運作為證。`mergePullRequest` 同權限。
- **Checks: Read**（`getPullChecks` 查 check-runs）— 可能未授予。`getPullChecks` 以 try/catch 包裹，失敗或無權限一律回 `'pending'`（狀態燈顯示灰／驗證中），**不阻擋核定／退件主流程**。
- audit 記錄沿用既有 `insertAuditLog(db, { org, action, actor, target })`（`src/db/queries.ts`，既有 action 如 `submission_created`）。

**紀律：** pnpm；commit 訊息結尾附 `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`；工作目錄 `scope3-worker/`、git root 上層；**直接 main、各 Task 只 commit 不 push**。

---

### Task 1：擴充 `OpenPR` 介面帶出 `head.sha` 與 `labels`

**Files:**
- Modify: `scope3-worker/src/github/pr.ts:37`（`OpenPR` interface）
- Test: `scope3-worker/tests/github/pr.test.ts`

- [ ] **Step 1：在既有 `pr.test.ts` 的 makeOctokit `GET /pulls` mock 補上 sha 與 labels，新增測試**

既有測試已 mock `GET /repos/{owner}/{repo}/pulls`。確認該 mock 回傳的每筆 PR 物件含 `head: { ref, sha }` 與 `labels`（若既有 mock 只有 `head.ref`，補上 `sha` 與 `labels`）。新增：

```typescript
it('listOpenPullRequestsByPrefix carries head.sha and labels', async () => {
  const prs = await listOpenPullRequestsByPrefix(octokit as any, 'acme', 'sub/');
  expect(prs.length).toBeGreaterThan(0);
  expect(typeof prs[0].head.sha).toBe('string');
  expect(Array.isArray(prs[0].labels)).toBe(true);
});
```

（mock 的 `GET /pulls` 回傳範例需含如 `{ number: 1, title: '...', head: { ref: 'sub/SUP001/aaa', sha: 'abc123' }, labels: [{ name: 'status:revision' }] }`。）

- [ ] **Step 2：執行確認失敗**

Run: `cd /Users/lightman/yao.care/agent.scope3esg/scope3-worker && pnpm vitest run --config vitest.middleware.config.ts tests/github/pr.test.ts`
Expected: FAIL（型別上 `prs[0].head.sha`／`prs[0].labels` 不存在，或 mock 未含被斷言為 undefined）

- [ ] **Step 3：擴充 interface**

把 `src/github/pr.ts:37` 的：
```typescript
export interface OpenPR { number: number; title: string; head: { ref: string }; }
```
改為：
```typescript
export interface OpenPR { number: number; title: string; head: { ref: string; sha: string }; labels: { name: string }[]; }
```
（`listOpenPullRequestsByPrefix` 不需改：`GET /pulls` 回應本就含 `head.sha` 與 `labels`，cast 後即帶出。）

- [ ] **Step 4：執行確認通過**

Run: `pnpm vitest run --config vitest.middleware.config.ts tests/github/pr.test.ts`
Expected: PASS（含既有案例）

- [ ] **Step 5：Commit**

```bash
cd /Users/lightman/yao.care/agent.scope3esg
git add scope3-worker/src/github/pr.ts scope3-worker/tests/github/pr.test.ts
git commit -m "$(printf 'feat: OpenPR carries head.sha and labels for review center\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>')"
```

---

### Task 2：讀類 helper — `getFileOnBranch`、`getPullChecks`

**Files:**
- Modify: `scope3-worker/src/github/pr.ts`（新增兩函式）
- Test: `scope3-worker/tests/github/pr.test.ts`

- [ ] **Step 1：寫失敗測試**（沿用 makeOctokit；補對應 route mock）

在 makeOctokit 的 request mock 加分支：
```typescript
      if (route === 'GET /repos/{owner}/{repo}/contents/{path}' && params?.ref === 'sub/SUP001/aaa') {
        const json = JSON.stringify({ submission_id: 'aaa', supplier_id: 'SUP001', scope3_category: 1, period: '2025-Q1', activity_type: 'electricity', amount: 100, unit: 'kWh' });
        return { data: { content: Buffer.from(json, 'utf-8').toString('base64'), sha: 'blobsha1' } };
      }
      if (route === 'GET /repos/{owner}/{repo}/commits/{ref}/check-runs') {
        return { data: { check_runs: [{ conclusion: 'success' }] } };
      }
```
新增測試：
```typescript
it('getFileOnBranch returns parsed JSON and blob sha', async () => {
  const r = await getFileOnBranch(octokit as any, 'acme', 'sub/SUP001/aaa', 'submissions/SUP001/aaa.json');
  expect(r).not.toBeNull();
  expect(r!.sha).toBe('blobsha1');
  expect((r!.data as any).period).toBe('2025-Q1');
});

it('getPullChecks maps check-run conclusions to a status', async () => {
  expect(await getPullChecks(octokit as any, 'acme', 'anysha')).toBe('success');
});
```
（記得 import `getFileOnBranch`、`getPullChecks`。）

- [ ] **Step 2：執行確認失敗**

Run: `pnpm vitest run --config vitest.middleware.config.ts tests/github/pr.test.ts`
Expected: FAIL（函式未定義）

- [ ] **Step 3：實作（加到 `src/github/pr.ts`）**

```typescript
// 讀分支上某檔的 JSON 內容與 blob sha（審核詳情／原地編輯用）。
export async function getFileOnBranch(
  octokit: Octokit, org: string, branch: string, path: string,
): Promise<{ data: Record<string, unknown>; sha: string } | null> {
  try {
    const { data } = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
      owner: org, repo: REPO, path, ref: branch,
    });
    const d = data as { content?: string; sha?: string };
    if (!d.content || !d.sha) return null;
    const bytes = Uint8Array.from(atob(d.content.replace(/\n/g, '')), (c) => c.charCodeAt(0));
    return { data: JSON.parse(new TextDecoder('utf-8').decode(bytes)), sha: d.sha };
  } catch {
    return null;
  }
}

// 查某 commit 的 check-runs 結論，映射為 validate 狀態三態。
// 需 App Checks:Read；無權限／查無一律回 'pending'（灰／驗證中），不阻擋主流程。
export async function getPullChecks(octokit: Octokit, org: string, sha: string): Promise<'success' | 'failure' | 'pending'> {
  try {
    const { data } = await octokit.request('GET /repos/{owner}/{repo}/commits/{ref}/check-runs', {
      owner: org, repo: REPO, ref: sha,
    });
    const runs = (data as { check_runs?: Array<{ conclusion: string | null }> }).check_runs ?? [];
    if (runs.length === 0) return 'pending';
    if (runs.some((r) => r.conclusion === 'failure')) return 'failure';
    if (runs.every((r) => r.conclusion === 'success')) return 'success';
    return 'pending';
  } catch {
    return 'pending';
  }
}
```

- [ ] **Step 4：執行確認通過**

Run: `pnpm vitest run --config vitest.middleware.config.ts tests/github/pr.test.ts`
Expected: PASS

- [ ] **Step 5：Commit**

```bash
cd /Users/lightman/yao.care/agent.scope3esg
git add scope3-worker/src/github/pr.ts scope3-worker/tests/github/pr.test.ts
git commit -m "$(printf 'feat: add getFileOnBranch and getPullChecks read helpers\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>')"
```

---

### Task 3：寫類 helper — `mergePullRequest`、`addLabelToPR`、`commentOnPR`

**Files:**
- Modify: `scope3-worker/src/github/pr.ts`（新增三函式）
- Test: `scope3-worker/tests/github/pr.test.ts`

- [ ] **Step 1：寫失敗測試**（補 route mock）

在 makeOctokit request mock 加：
```typescript
      if (route === 'PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge') return { data: { merged: true } };
      if (route === 'POST /repos/{owner}/{repo}/issues/{issue_number}/labels') return { data: [{ name: 'status:revision' }] };
      if (route === 'POST /repos/{owner}/{repo}/issues/{issue_number}/comments') return { data: { id: 1 } };
```
新增測試：
```typescript
it('mergePullRequest calls the merge endpoint', async () => {
  await mergePullRequest(octokit as any, 'acme', 7);
  expect(octokit.request).toHaveBeenCalledWith('PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge', expect.objectContaining({ owner: 'acme', repo: 'scope3-inventory', pull_number: 7 }));
});
it('addLabelToPR posts the label', async () => {
  await addLabelToPR(octokit as any, 'acme', 7, 'status:revision');
  expect(octokit.request).toHaveBeenCalledWith('POST /repos/{owner}/{repo}/issues/{issue_number}/labels', expect.objectContaining({ issue_number: 7, labels: ['status:revision'] }));
});
it('commentOnPR posts a comment body', async () => {
  await commentOnPR(octokit as any, 'acme', 7, 'hello');
  expect(octokit.request).toHaveBeenCalledWith('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', expect.objectContaining({ issue_number: 7, body: 'hello' }));
});
```
（import 三函式。）

- [ ] **Step 2：執行確認失敗**

Run: `pnpm vitest run --config vitest.middleware.config.ts tests/github/pr.test.ts`
Expected: FAIL（函式未定義）

- [ ] **Step 3：實作（加到 `src/github/pr.ts`）**

```typescript
// 核定＝merge PR（Worker 用 App token 代為 merge，觸發租戶 repo 的 calculate）。
export async function mergePullRequest(octokit: Octokit, org: string, prNumber: number): Promise<void> {
  await octokit.request('PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge', {
    owner: org, repo: REPO, pull_number: prNumber,
  });
}

export async function addLabelToPR(octokit: Octokit, org: string, prNumber: number, label: string): Promise<void> {
  await octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/labels', {
    owner: org, repo: REPO, issue_number: prNumber, labels: [label],
  });
}

export async function commentOnPR(octokit: Octokit, org: string, prNumber: number, body: string): Promise<void> {
  await octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', {
    owner: org, repo: REPO, issue_number: prNumber, body,
  });
}
```

- [ ] **Step 4：執行確認通過**

Run: `pnpm vitest run --config vitest.middleware.config.ts tests/github/pr.test.ts`
Expected: PASS

- [ ] **Step 5：Commit**

```bash
cd /Users/lightman/yao.care/agent.scope3esg
git add scope3-worker/src/github/pr.ts scope3-worker/tests/github/pr.test.ts
git commit -m "$(printf 'feat: add merge/label/comment write helpers for review actions\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>')"
```

---

### Task 4：審核 API — `review/list`、`review/:pr/approve`、`review/:pr/reject`

**Files:**
- Modify: `scope3-worker/src/routes/admin-api.ts`（新增三端點；import 補 `getFileOnBranch`、`getPullChecks`、`mergePullRequest`、`addLabelToPR`、`commentOnPR`、`insertAuditLog`）
- Test: `scope3-worker/tests/routes/admin-api.test.ts`

- [ ] **Step 1：寫失敗測試**（沿用既有 mock 範式）

新增三案例（沿用既有 session cookie 與 `getInstallationOctokit` mock 範式）：
```typescript
it('GET /:org/review/list returns submission PRs with details + validate status', async () => {
  // mock GET /pulls 回 1 筆 sub/SUP001/aaa（head.sha, labels:[]）、contents?ref 回提交 JSON、check-runs 回 success
  const res = await appFetch('/api/v1/admin/acme/review/list', { headers: { Cookie: validSessionCookie } });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.reviews[0]).toMatchObject({ type: 'submission', supplier_id: 'SUP001', validate: 'success' });
});

it('POST /:org/review/:pr/approve merges the PR', async () => {
  const res = await appFetch('/api/v1/admin/acme/review/7/approve', { method: 'POST', headers: { Cookie: validSessionCookie } });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
  // 斷言 octokit.request 被以 merge endpoint 呼叫
});

it('POST /:org/review/:pr/reject adds label + comment with reason', async () => {
  const res = await appFetch('/api/v1/admin/acme/review/7/reject', {
    method: 'POST', headers: { Cookie: validSessionCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: '數量單位錯誤' }),
  });
  expect(res.status).toBe(200);
  // 斷言 labels 端點被以 ['status:revision'] 呼叫、comments 端點 body 以 '<!-- reject -->' 開頭
});
```
（helper 名稱 `appFetch`／`validSessionCookie` 對應該檔既有實際名稱。）

- [ ] **Step 2：執行確認失敗**

Run: `pnpm vitest run tests/routes/admin-api.test.ts`
Expected: FAIL（端點不存在）

- [ ] **Step 3：實作（加到 `src/routes/admin-api.ts`，於 `review/count` 之後）**

import 區補上（若未匯入）：`getFileOnBranch, getPullChecks, mergePullRequest, addLabelToPR, commentOnPR` from `'../github/pr'`；`insertAuditLog` from `'../db/queries'`。

```typescript
adminApi.get('/:org/review/list', async (c) => {
  const { org } = c.req.param();
  const tenant = await getTenantByOrg(c.env.DB, org);
  if (!tenant) return c.json({ reviews: [] });
  const octokit = await getInstallationOctokit(c.env, tenant.installationId);
  const subs = await listOpenPullRequestsByPrefix(octokit, org, 'sub/');
  const wds = await listOpenPullRequestsByPrefix(octokit, org, 'withdraw/');
  const reviews: Record<string, unknown>[] = [];
  for (const pr of subs) {
    const [, supplierId, submissionId] = pr.head.ref.split('/'); // sub/{sid}/{uuid}
    const file = await getFileOnBranch(octokit, org, pr.head.ref, `submissions/${supplierId}/${submissionId}.json`);
    const validate = await getPullChecks(octokit, org, pr.head.sha);
    reviews.push({
      number: pr.number, type: 'submission', branch: pr.head.ref, title: pr.title,
      supplier_id: supplierId, validate,
      needsRevision: pr.labels.some((l) => l.name === 'status:revision'),
      data: file ? file.data : null,
    });
  }
  for (const pr of wds) {
    const [, supplierId] = pr.head.ref.split('/');
    reviews.push({ number: pr.number, type: 'withdrawal', branch: pr.head.ref, title: pr.title, supplier_id: supplierId });
  }
  return c.json({ reviews });
});

adminApi.post('/:org/review/:pr/approve', async (c) => {
  const { org, pr } = c.req.param();
  const tenant = await getTenantByOrg(c.env.DB, org);
  if (!tenant) return c.json({ error: 'unknown org' }, 404);
  const octokit = await getInstallationOctokit(c.env, tenant.installationId);
  try {
    await mergePullRequest(octokit, org, Number(pr));
    await insertAuditLog(c.env.DB, { org, action: 'submission_approved', actor: 'manager', target: `pr#${pr}` });
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: 'merge failed', detail: String((e as { message?: string }).message ?? e) }, 409);
  }
});

adminApi.post('/:org/review/:pr/reject', async (c) => {
  const { org, pr } = c.req.param();
  const tenant = await getTenantByOrg(c.env.DB, org);
  if (!tenant) return c.json({ error: 'unknown org' }, 404);
  const body = await c.req.json<{ reason?: string }>().catch(() => ({ reason: '' }));
  const reason = (body.reason ?? '').trim() || '（未填理由）';
  const octokit = await getInstallationOctokit(c.env, tenant.installationId);
  await addLabelToPR(octokit, org, Number(pr), 'status:revision');
  await commentOnPR(octokit, org, Number(pr), `<!-- reject -->\n**退件理由**：${reason}`);
  await insertAuditLog(c.env.DB, { org, action: 'submission_rejected', actor: 'manager', target: `pr#${pr}` });
  return c.json({ ok: true });
});
```

> 註：`insertAuditLog` 的參數形狀請對齊 `src/db/queries.ts` 既有定義（若欄位名不同，依實際定義調整）。

- [ ] **Step 4：執行確認通過**

Run: `pnpm vitest run tests/routes/admin-api.test.ts`
Expected: PASS

- [ ] **Step 5：Commit**

```bash
cd /Users/lightman/yao.care/agent.scope3esg
git add scope3-worker/src/routes/admin-api.ts scope3-worker/tests/routes/admin-api.test.ts
git commit -m "$(printf 'feat: review list/approve/reject API endpoints\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>')"
```

---

### Task 5：審核中心頁面 `/admin/:org/review` ＋ 路由註冊

**Files:**
- Create: `scope3-worker/src/admin/review-page.ts`（`reviewPageHtml(org)`）
- Modify: `scope3-worker/src/routes/admin.ts`（註冊 `GET /:org/review`，session 保護）

- [ ] **Step 1：建立 `src/admin/review-page.ts`**

比照 `src/routes/dashboard.ts` 風格（server template literal 注入 org、前端 JS 字串拼接、套 `/assets/app.css`、頂部 `renderNav(org,'review')`）。內容：fetch `/api/v1/admin/{org}/review/list` 渲染待審清單；每筆顯示類型/供應商/（提交的）類別期間活動數量/validate 狀態燈/佐證連結；核定鈕 POST approve、退件鈕 `prompt` 輸入理由後 POST reject；動作後 reload。

```typescript
// src/admin/review-page.ts
import { renderNav } from '../ui/nav';

export function reviewPageHtml(org: string): string {
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Scope 3 審核中心 — ${org}</title>
<link rel="stylesheet" href="/assets/app.css">
</head>
<body>
${renderNav(org, 'review')}
<div class="container">
<h1>審核中心 — ${org}</h1>
<p class="muted" id="subtitle">載入中…</p>
<div id="list"></div>
</div>
<script>
var ORG = ${JSON.stringify(org)};
var CAT_NAMES = ['採購商品與服務','資本財','燃料與能源','上游運輸配送','營運廢棄物','商務旅行','員工通勤','上游租賃資產','下游運輸配送','售出產品加工','售出產品使用','售出產品報廢','下游租賃資產','加盟','投資'];
function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function light(v){ var m={success:['✅','已驗證'],failure:['❌','驗證未過'],pending:['⏳','驗證中']}; var x=m[v]||m.pending; return '<span class="badge">'+x[0]+' '+x[1]+'</span>'; }
function approve(pr){ if(!confirm('確定核定並 merge 此 PR？')) return;
  fetch('/api/v1/admin/'+ORG+'/review/'+pr+'/approve',{method:'POST'}).then(function(r){return r.json();}).then(function(d){
    if(d.ok){ load(); } else { alert('核定失敗：'+(d.detail||d.error||'')); }
  }); }
function reject(pr){ var reason=prompt('退件理由（會顯示給供應商）：'); if(reason===null) return;
  fetch('/api/v1/admin/'+ORG+'/review/'+pr+'/reject',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reason:reason})})
    .then(function(r){return r.json();}).then(function(){ load(); }); }
function rowHtml(r){
  var head, body='';
  if(r.type==='withdrawal'){
    head='<strong>撤回</strong> ｜ '+esc(r.supplier_id)+' ｜ '+esc(r.title);
  } else {
    var d=r.data||{};
    head='<strong>提交</strong> ｜ '+esc(r.supplier_id)+' ｜ Cat.'+esc(d.scope3_category)+' '+esc(CAT_NAMES[(d.scope3_category||1)-1]||'')+' ｜ '+esc(d.period)+' ｜ '+light(r.validate)+(r.needsRevision?' <span class="badge">需修改</span>':'');
    body='<div class="muted">活動：'+esc(d.activity_type)+' ｜ 數量：'+esc(d.amount)+' '+esc(d.unit)+'</div>';
    var ev=(d.evidence_urls||[]); if(ev.length){ body+='<div class="muted">佐證：'+ev.map(function(u,i){return '<a href="'+esc(u)+'" target="_blank">檔'+(i+1)+'</a>';}).join(' ')+'</div>'; }
  }
  var actions = r.type==='withdrawal'
    ? '<button class="btn btn-primary" onclick="approve('+r.number+')">確認撤回</button> <button class="btn btn-secondary" onclick="reject('+r.number+')">駁回</button>'
    : '<button class="btn btn-primary" onclick="approve('+r.number+')">核定</button> <button class="btn btn-danger" onclick="reject('+r.number+')">退件</button>';
  return '<section class="card"><div>'+head+'</div>'+body+'<p>'+actions+'</p></section>';
}
function load(){
  fetch('/api/v1/admin/'+ORG+'/review/list').then(function(r){return r.json();}).then(function(d){
    var rv=d.reviews||[];
    document.getElementById('subtitle').textContent='待審 '+rv.length+' 筆';
    document.getElementById('list').innerHTML = rv.length ? rv.map(rowHtml).join('') : '<div class="card muted">目前沒有待審項目</div>';
  }).catch(function(){ document.getElementById('subtitle').textContent='無法載入'; });
}
load();
</script>
</body>
</html>`;
}
```

- [ ] **Step 2：在 `src/routes/admin.ts` 註冊 `GET /:org/review`**

import 補：`import { reviewPageHtml } from '../admin/review-page';`
在 `admin.get('/:org', …)` 之後新增（沿用同樣的 session 檢查）：
```typescript
admin.get('/:org/review', async (c) => {
  const { org } = c.req.param();
  const cookie = readCookie(c, SESSION_COOKIE);
  const session = cookie ? await verifySession(cookie, c.env.SESSION_SECRET) : null;
  if (!session || session.org !== org) {
    return c.redirect(`/admin/${org}/login`);
  }
  return c.html(reviewPageHtml(org));
});
```

- [ ] **Step 3：型別檢查 ＋ 全套測試**

Run:
```bash
cd /Users/lightman/yao.care/agent.scope3esg/scope3-worker
pnpm tsc --noEmit 2>&1 | grep -E "^src/" || echo "src clean"
pnpm test 2>&1 | grep -E "Test Files|Tests |failed|FAIL"
```
Expected: `src clean`；兩 pool 全綠。

- [ ] **Step 4：Commit**

```bash
cd /Users/lightman/yao.care/agent.scope3esg
git add scope3-worker/src/admin/review-page.ts scope3-worker/src/routes/admin.ts
git commit -m "$(printf 'feat: review center page at /admin/:org/review\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>')"
```

---

## 驗收（Plan 2 完成標準）

- `pnpm test` 兩 pool 全綠、`tsc` src clean。
- `OpenPR` 帶 `head.sha`＋`labels`；6 個新 helper 各有 mock 測試。
- `GET /review/list` 回提交（含詳情＋validate 狀態＋needsRevision）與撤回兩類待審；`approve` merge PR（失敗回 409）；`reject` 加 `status:revision` label＋`<!-- reject -->` 退件留言。
- `/admin/:org/review` 頁面（session 保護）顯示待審清單、核定／退件可操作；導覽列 active=review、badge 數一致。
- （部署後人工檢查）登入 `/admin/yao-care/review`：提一筆測試提交→出現在待審→核定→PR merge→儀表板更新；或退件→PR 加 label＋留言。
