# Manager 工作台 Plan 3：供應商退件閉環＋原地編輯 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 供應商在填表頁看到被退件的提交標「需修改」＋退件理由、撤回中的提交標「撤回審核中」，並能原地編輯被退的提交（預填→改→更新同一 PR 重審、移除 status:revision label）。

**Architecture:** `src/github/pr.ts` 新增 `updateFileOnBranch`（帶 branch＋sha 更新既有檔）、`removeLabelFromPR`、`getLatestRejectReason`。`src/routes/submit.ts` 的 GET 清單改為查 PR labels 判 needsRevision＋取退件理由、查 `withdraw/` PR 標撤回中；新增 `GET/POST /:org/:token/edit/:submissionId`（預填編輯表單＋直接 updateFileOnBranch 更新分支檔，不經 processSubmission 以保留 submission_id）。

**Tech Stack:** TypeScript、Hono、Cloudflare Workers、Vitest（兩 pool）、pnpm。

**對應 spec：** `docs/superpowers/specs/2026-05-27-scope3-manager-workbench-design.md` 區塊 3。

**依賴：** Plan 2 已備 `OpenPR`(head.sha+labels)、`getFileOnBranch`（回 {data,sha}）。`commitFileToBranch`／`toBase64`／`listOpenPullRequestsByPrefix`／`getSupplierToken`／`getInstallationOctokit`／`getTenantByOrg`／R2 上傳邏輯（submit.ts POST 既有）皆已存在。

**紀律：** pnpm；commit 附 `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`；工作目錄 `scope3-worker/`；**直接 main、各 Task 只 commit 不 push**。

---

### Task 1：pr.ts 新增 `updateFileOnBranch`、`removeLabelFromPR`、`getLatestRejectReason`

**Files:**
- Modify: `scope3-worker/src/github/pr.ts`
- Test: `scope3-worker/tests/github/pr.test.ts`

- [ ] **Step 1：寫失敗測試**（沿用 makeOctokit；補 route mock）

在 makeOctokit request mock 加分支：
```typescript
      if (route === 'PUT /repos/{owner}/{repo}/contents/{path}' && params?.sha === 'oldsha') return { data: { commit: { sha: 'newcommit' } } };
      if (route === 'DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels/{name}') return { data: [] };
      if (route === 'GET /repos/{owner}/{repo}/issues/{issue_number}/comments') {
        return { data: [
          { body: '## ⚠️ 驗證發現問題\n單位錯誤' },
          { body: '<!-- reject -->\n**退件理由**：請改用 kWh' },
          { body: '一般留言' },
        ] };
      }
```
新增測試：
```typescript
it('updateFileOnBranch PUTs with branch and sha', async () => {
  await updateFileOnBranch(octokit as any, 'acme', 'sub/SUP001/aaa', 'submissions/SUP001/aaa.json', '{}', 'oldsha', 'edit');
  expect(octokit.request).toHaveBeenCalledWith('PUT /repos/{owner}/{repo}/contents/{path}', expect.objectContaining({ branch: 'sub/SUP001/aaa', sha: 'oldsha', path: 'submissions/SUP001/aaa.json' }));
});
it('removeLabelFromPR deletes the named label', async () => {
  await removeLabelFromPR(octokit as any, 'acme', 7, 'status:revision');
  expect(octokit.request).toHaveBeenCalledWith('DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels/{name}', expect.objectContaining({ issue_number: 7, name: 'status:revision' }));
});
it('getLatestRejectReason returns the reason from the last reject-marked comment', async () => {
  const r = await getLatestRejectReason(octokit as any, 'acme', 7);
  expect(r).toBe('請改用 kWh');
});
```
（import 三函式。）

- [ ] **Step 2：執行確認失敗**

Run: `cd /Users/lightman/yao.care/agent.scope3esg/scope3-worker && pnpm vitest run --config vitest.middleware.config.ts tests/github/pr.test.ts`
Expected: FAIL（函式未定義）

- [ ] **Step 3：實作（加到 `src/github/pr.ts`，`toBase64`/`REPO` 已存在）**

```typescript
// 更新分支上既有檔（原地編輯；需該檔在該分支的 blob sha，與 commitFileToBranch 的差別在帶 sha）。
export async function updateFileOnBranch(octokit: Octokit, org: string, branch: string, path: string, content: string, sha: string, message: string): Promise<void> {
  await octokit.request('PUT /repos/{owner}/{repo}/contents/{path}', {
    owner: org, repo: REPO, path, message, content: toBase64(content), branch, sha,
  });
}

// 移除 PR 的某 label（label 不存在會 404，視為已移除而忽略）。
export async function removeLabelFromPR(octokit: Octokit, org: string, prNumber: number, label: string): Promise<void> {
  try {
    await octokit.request('DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels/{name}', {
      owner: org, repo: REPO, issue_number: prNumber, name: label,
    });
  } catch { /* label 不存在 → 忽略 */ }
}

// 讀 PR 留言，取最後一則含 <!-- reject --> 標記的退件理由內文（不與 validate 留言混淆）。
// per_page=100；>100 留言為已知邊界（罕見）。
export async function getLatestRejectReason(octokit: Octokit, org: string, prNumber: number): Promise<string | null> {
  try {
    const { data } = await octokit.request('GET /repos/{owner}/{repo}/issues/{issue_number}/comments', {
      owner: org, repo: REPO, issue_number: prNumber, per_page: 100,
    });
    const comments = (data as Array<{ body?: string }>) ?? [];
    for (let i = comments.length - 1; i >= 0; i--) {
      const body = comments[i].body ?? '';
      if (body.includes('<!-- reject -->')) {
        const m = body.match(/退件理由[:：]\s*([\s\S]*)$/);
        return m ? m[1].trim() : body.replace('<!-- reject -->', '').trim();
      }
    }
    return null;
  } catch {
    return null;
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
git commit -m "$(printf 'feat: add updateFileOnBranch, removeLabelFromPR, getLatestRejectReason\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>')"
```

---

### Task 2：填表頁清單顯示退件理由與撤回狀態

**Files:**
- Modify: `scope3-worker/src/routes/submit.ts`（GET handler ＋ `formHtml`）

- [ ] **Step 1：import 補 helper**

`src/routes/submit.ts` 檔首 import（from `'../github/pr'`）補上 `getLatestRejectReason`（`listOpenPullRequestsByPrefix`、`listSupplierSubmissions` 已有）。

- [ ] **Step 2：改 GET `/:org/:token` 蒐集退件理由與撤回狀態**

把現有 GET handler 的 try 區塊改為（保留外層 token 驗證與 try/catch）：
```typescript
    const tenant = await getTenantByOrg(c.env.DB, org);
    if (tenant) {
      const octokit = await getInstallationOctokit(c.env, tenant.installationId);
      approved = await listSupplierSubmissions(octokit, org, tokenRow.supplierId);
      const subPrs = await listOpenPullRequestsByPrefix(octokit, org, `sub/${tokenRow.supplierId}/`);
      pending = await Promise.all(subPrs.map(async (p) => {
        const submissionId = p.head.ref.split('/').pop();
        const needsRevision = p.labels.some((l) => l.name === 'status:revision');
        const rejectReason = needsRevision ? await getLatestRejectReason(octokit, org, p.number) : null;
        return { number: p.number, title: p.title, submissionId, needsRevision, rejectReason };
      }));
      const wdPrs = await listOpenPullRequestsByPrefix(octokit, org, `withdraw/${tokenRow.supplierId}/`);
      withdrawnIds = wdPrs.map((p) => p.head.ref.split('/').pop());
    }
```
在 handler 開頭宣告 `let withdrawnIds: (string | undefined)[] = [];`，並把 `pending` 型別改為 `Array<{ number: number; title: string; submissionId: string | undefined; needsRevision: boolean; rejectReason: string | null }>`。最後 `return c.html(formHtml(org, token, tokenRow.supplierId, approved, pending, withdrawnIds));`

- [ ] **Step 3：改 `formHtml` 簽名與清單渲染**

`formHtml` 簽名加 `withdrawnIds: (string | undefined)[]`，並把 pending 參數型別同步上面。修改「我的提交紀錄」表格 tbody：

待審列（pending）改為顯示狀態與理由，操作含「編輯」＋「撤回」：
```javascript
      ${pending.map((p) => `<tr>
        <td colspan="4">${esc(p.title)}</td>
        <td>${p.needsRevision ? `<span class="badge">需修改</span>` : `<span class="badge">審核中</span>`}${p.needsRevision && p.rejectReason ? `<div class="muted">退件理由：${esc(p.rejectReason)}</div>` : ''}</td>
        <td>${p.submissionId ? `<a class="btn btn-secondary" href="/submit/${esc(org)}/${esc(token)}/edit/${esc(p.submissionId)}">編輯</a> ${withdrawBtn(p.submissionId)}` : ''}</td>
      </tr>`).join('')}
```
已核定列（approved）：若 `submission_id` 在 withdrawnIds → 顯示「撤回審核中」且不給撤回鈕；否則「已核定」＋撤回鈕：
```javascript
      ${approved.map((s) => {
        const isWithdrawing = withdrawnIds.indexOf(s.submission_id) >= 0;
        return `<tr><td>${esc(s.period)}</td><td>Cat.${esc(s.scope3_category)}</td><td>${esc(s.activity_type)}</td><td>${esc(s.amount)} ${esc(s.unit)}</td><td>${isWithdrawing ? '<span class="badge">撤回審核中</span>' : '<span class="badge">已核定</span>'}</td><td>${isWithdrawing ? '' : withdrawBtn(s.submission_id)}</td></tr>`;
      }).join('')}
```
（`withdrawBtn` 既有；保留空清單列判斷，colspan 維持 6。）

- [ ] **Step 4：型別檢查 ＋ 既有測試**

Run:
```bash
cd /Users/lightman/yao.care/agent.scope3esg/scope3-worker
pnpm tsc --noEmit 2>&1 | grep -E "^src/" || echo "src clean"
pnpm test 2>&1 | grep -E "Test Files|Tests |failed|FAIL"
```
Expected: `src clean`；兩 pool 全綠（submit 無專屬 route 測試，確認不破壞既有）。

- [ ] **Step 5：Commit**

```bash
cd /Users/lightman/yao.care/agent.scope3esg
git add scope3-worker/src/routes/submit.ts
git commit -m "$(printf 'feat: show reject reason and withdrawal status on supplier form list\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>')"
```

---

### Task 3：原地編輯端點（預填表單＋更新分支檔）

**Files:**
- Modify: `scope3-worker/src/routes/submit.ts`（新增 `editFormHtml` ＋ `GET/POST /:org/:token/edit/:submissionId`）

- [ ] **Step 1：import 補 helper**

`src/routes/submit.ts` import（from `'../github/pr'`）補 `getFileOnBranch`、`updateFileOnBranch`、`removeLabelFromPR`（其餘已有）。

- [ ] **Step 2：新增 `editFormHtml`（預填編輯表單）**

在 `formHtml` 之後加（重用相同欄位，預填 data 值，action 指向 edit，並用 JS 設定 select/unit 預設值）：
```typescript
function editFormHtml(org: string, token: string, supplierId: string, submissionId: string, data: Record<string, unknown>): string {
  const d = data as { scope3_category?: number; period?: string; activity_type?: string; amount?: number; unit?: string };
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>編輯提交</title><link rel="stylesheet" href="/assets/app.css"></head>
<body><div class="container">
<h1>編輯提交</h1>
<p class="supplier-note">供應商：<strong>${esc(supplierId)}</strong>｜提交：${esc(submissionId)}</p>
<section class="card">
<form method="POST" action="/submit/${esc(org)}/${esc(token)}/edit/${esc(submissionId)}" enctype="multipart/form-data">
  <label class="label">盤點類別 (Scope 3 Category)</label>
  <select class="select" name="scope3_category" required>
    ${Array.from({length:15},(_,i)=>`<option value="${i+1}" ${Number(d.scope3_category)===i+1?'selected':''}>Category ${i+1}</option>`).join('')}
  </select>
  <label class="label">期間（例：2025-Q1）</label>
  <input class="input" name="period" value="${esc(d.period)}" required pattern="\\d{4}-Q[1-4]">
  <label class="label">活動類型</label>
  <select class="select" name="activity_type" id="activity_type" required>
    ${['electricity','natural_gas','diesel','water','waste','product','transport'].map((a)=>`<option value="${a}" ${d.activity_type===a?'selected':''}>${a}</option>`).join('')}
  </select>
  <div class="row">
    <div><label class="label">數量</label><input class="input" name="amount" type="number" step="any" value="${esc(d.amount)}" required></div>
    <div><label class="label">單位</label><select class="select" name="unit" id="unit" required></select></div>
  </div>
  <label class="label">補充佐證文件（可選；會附加到原佐證）</label>
  <input class="input" name="files" type="file" multiple accept=".pdf,.xlsx,.csv,.jpg,.png">
  <button class="btn btn-primary btn-lg" type="submit">更新並重新送審</button>
</form>
<p><a class="btn btn-secondary" href="/submit/${esc(org)}/${esc(token)}">取消，返回清單</a></p>
</section>
<script>
  var ACTIVITY_UNITS = { electricity:[['kWh','kWh']], natural_gas:[['Nm3','Nm3']], diesel:[['L','公升 (L)']], water:[['ton','公噸 (ton)']], waste:[['ton','公噸 (ton)'],['kg','公斤 (kg)']], product:[['pcs','件 (pcs)'],['kg','公斤 (kg)'],['ton','公噸 (ton)']], transport:[['km','公里 (km)']] };
  var actEl=document.getElementById('activity_type'), unitEl=document.getElementById('unit');
  var CUR_UNIT=${JSON.stringify(d.unit ?? '')};
  function syncUnits(){ var opts=ACTIVITY_UNITS[actEl.value]||[]; unitEl.innerHTML=opts.map(function(o){return '<option value="'+o[0]+'" '+(o[0]===CUR_UNIT?'selected':'')+'>'+o[1]+'</option>';}).join(''); }
  actEl.addEventListener('change', function(){ CUR_UNIT=''; syncUnits(); });
  syncUnits();
</script>
</div></body></html>`;
}
```

- [ ] **Step 3：新增 GET 預填端點**（放在 POST `/:org/:token/withdraw` 之後）

```typescript
submit.get('/:org/:token/edit/:submissionId', async (c) => {
  const { org, token, submissionId } = c.req.param();
  const tokenRow = await getSupplierToken(c.env.DB, token);
  if (!tokenRow || tokenRow.org !== org) return c.text('無效的連結', 401);
  const tenant = await getTenantByOrg(c.env.DB, org);
  if (!tenant) return c.text('租戶不存在', 404);
  const octokit = await getInstallationOctokit(c.env, tenant.installationId);
  const branch = `sub/${tokenRow.supplierId}/${submissionId}`;
  const path = `submissions/${tokenRow.supplierId}/${submissionId}.json`;
  const file = await getFileOnBranch(octokit, org, branch, path);
  if (!file) return c.text('找不到可編輯的提交（可能已核定或不存在）', 404);
  return c.html(editFormHtml(org, token, tokenRow.supplierId, submissionId, file.data));
});
```

- [ ] **Step 4：新增 POST 更新端點**

```typescript
submit.post('/:org/:token/edit/:submissionId', async (c) => {
  const { org, token, submissionId } = c.req.param();
  const tokenRow = await getSupplierToken(c.env.DB, token);
  if (!tokenRow || tokenRow.org !== org) return c.text('無效的連結', 401);
  const tenant = await getTenantByOrg(c.env.DB, org);
  if (!tenant) return c.text('租戶不存在', 404);
  const octokit = await getInstallationOctokit(c.env, tenant.installationId);
  const branch = `sub/${tokenRow.supplierId}/${submissionId}`;
  const path = `submissions/${tokenRow.supplierId}/${submissionId}.json`;

  const file = await getFileOnBranch(octokit, org, branch, path);
  if (!file) return c.text('找不到可編輯的提交', 404);

  const formData = await c.req.formData();
  // 新上傳佐證 append 到原 evidence_urls
  const evidenceUrls: string[] = Array.isArray((file.data as { evidence_urls?: string[] }).evidence_urls)
    ? [...((file.data as { evidence_urls: string[] }).evidence_urls)] : [];
  const files = formData.getAll('files') as unknown as File[];
  for (const f of files) {
    if (typeof f?.size !== 'number' || f.size === 0) continue;
    const ext = f.name.split('.').pop() ?? 'bin';
    const key = `${org}/${crypto.randomUUID()}.${ext}`;
    await c.env.FILES.put(key, await f.arrayBuffer(), { httpMetadata: { contentType: f.type } });
    evidenceUrls.push(`${c.env.WORKER_BASE_URL}/files/${key}`);
  }

  // 保留原 submission_id/supplier_id/submitted_at/channel 等，只更新可編輯欄位＋evidence
  const updated = {
    ...file.data,
    scope3_category: Number(formData.get('scope3_category')),
    period: String(formData.get('period')),
    activity_type: String(formData.get('activity_type')),
    amount: Number(formData.get('amount')),
    unit: String(formData.get('unit')),
    evidence_urls: evidenceUrls,
  };
  await updateFileOnBranch(octokit, org, branch, path, JSON.stringify(updated, null, 2), file.sha, `edit: ${tokenRow.supplierId} ${submissionId}`);

  // 找該提交的 PR，移除 status:revision label 讓重回審核中
  const prs = await listOpenPullRequestsByPrefix(octokit, org, branch);
  const exact = prs.find((p) => p.head.ref === branch);
  if (exact && exact.labels.some((l) => l.name === 'status:revision')) {
    await removeLabelFromPR(octokit, org, exact.number, 'status:revision');
  }
  return c.redirect(`/submit/${org}/${token}`);
});
```

- [ ] **Step 5：型別檢查 ＋ 全套測試**

Run:
```bash
cd /Users/lightman/yao.care/agent.scope3esg/scope3-worker
pnpm tsc --noEmit 2>&1 | grep -E "^src/" || echo "src clean"
pnpm test 2>&1 | grep -E "Test Files|Tests |failed|FAIL"
```
Expected: `src clean`；兩 pool 全綠。

- [ ] **Step 6：Commit**

```bash
cd /Users/lightman/yao.care/agent.scope3esg
git add scope3-worker/src/routes/submit.ts
git commit -m "$(printf 'feat: in-place edit of rejected submission (prefill + update branch + clear revision label)\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>')"
```

---

## 驗收（Plan 3 完成標準）

- `pnpm test` 兩 pool 全綠、`tsc` src clean。
- pr.ts 三 helper 各有 mock 測試（updateFileOnBranch 帶 sha、removeLabelFromPR 刪 named label、getLatestRejectReason 取 `<!-- reject -->` 標記理由不誤抓 validate 留言）。
- 填表頁：被退提交顯示「需修改」＋退件理由與「編輯」鈕；撤回中的已核定提交顯示「撤回審核中」（無撤回鈕）。
- 原地編輯：GET 預填表單（含 select/unit 正確預設）；POST 更新分支檔（保留 submission_id、append 佐證）→ PR synchronize 重審＋移除 status:revision label。
- （部署後人工檢查）Manager 退一筆 → 供應商填表頁見「需修改＋理由」→ 點編輯改值送出 → PR 更新、label 移除、回審核中 → Manager 再核定。
