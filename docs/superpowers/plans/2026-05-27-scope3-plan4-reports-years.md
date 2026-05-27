# Manager 工作台 Plan 4：報表＋年份篩選 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Manager 在 `/admin/:org/reports` 線上看該年 GHG 總覽、下載 CSV（Worker 即時讀 data/submissions.json 產生）；儀表板與報表頁可依年份篩選。

**Architecture:** 把 report-lib 純函式移植為 `src/lib/report.ts`（toCsv/toGhgMarkdown，TS）。`admin-api.ts` 的 `dashboard-data` 加 `?year=` 過濾並回傳 `availableYears`，新增 `GET /:org/reports?year=&format=csv|md`（讀 submissions.json 依 period 前 4 碼過濾→toCsv/toGhgMarkdown）。新增 `src/admin/reports-page.ts` 報表頁（年份下拉＋GHG 總覽＋下載 CSV），`admin.ts` 註冊 `GET /:org/reports`；dashboard 頁加年份下拉。

**Tech Stack:** TypeScript、Hono、Cloudflare Workers、Vitest（兩 pool）、pnpm。

**對應 spec：** `docs/superpowers/specs/2026-05-27-scope3-manager-workbench-design.md` 區塊 4＋5。

**依賴/接縫（已確認）：** `tenant-template/scripts/report-lib.mjs` 的 `toCsv(submissions)`／`toGhgMarkdown(submissions, year)`（CSV_COLUMNS 含 source_file；toGhgMarkdown 末尾有 `new Date().toISOString()` 時間戳）；`aggregateKpis(submissions)`（`lib/aggregate.ts`，不接受 year）；`readAggregatedSubmissions`（`admin-api.ts` module-private，回 any[]，記錄含 period）；`renderNav`（Plan 1）。年份＝`String(period).slice(0,4)`。

**紀律：** pnpm；commit 附 `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`；工作目錄 `scope3-worker/`；**直接 main、各 Task 只 commit 不 push**。

---

### Task 1：`src/lib/report.ts`（移植 toCsv／toGhgMarkdown 為 TS）＋ 雙份一致性交叉測試

**Files:**
- Create: `scope3-worker/src/lib/report.ts`
- Test: `scope3-worker/tests/lib/report.test.ts`（Node pool，可同時 import .ts 與 tenant-template 的 .mjs）

- [ ] **Step 1：寫失敗測試** `tests/lib/report.test.ts`：
```typescript
import { describe, it, expect } from 'vitest';
import { toCsv, toGhgMarkdown } from '../../src/lib/report';
import { toCsv as mjsToCsv, toGhgMarkdown as mjsToGhg } from '../../tenant-template/scripts/report-lib.mjs';

const FIX = [
  { submission_id: 'a', supplier_id: 'SUP001', scope3_category: 1, period: '2025-Q1', activity_type: 'electricity', amount: 100, unit: 'kWh', emission_factor_id: 'TW_ELEC_2025', calculated_co2e: 50, source_file: 'submissions/SUP001/a.json' },
  { submission_id: 'b', supplier_id: 'SUP002', scope3_category: 4, period: '2025-Q2', activity_type: 'transport', amount: 1200, unit: 'km', emission_factor_id: 'GLOBAL_TRANSPORT_2025', calculated_co2e: 144, source_file: 'submissions/SUP002/b.json' },
];

describe('report.ts', () => {
  it('toCsv emits header with source_file column and one row per submission', () => {
    const csv = toCsv(FIX);
    expect(csv.split('\n')[0]).toBe('submission_id,supplier_id,scope3_category,period,activity_type,amount,unit,emission_factor_id,calculated_co2e,source_file');
    expect(csv).toContain('a,SUP001,1,2025-Q1,electricity,100,kWh,TW_ELEC_2025,50,submissions/SUP001/a.json');
  });
  it('toCsv handles empty input (header only)', () => {
    expect(toCsv([])).toBe('submission_id,supplier_id,scope3_category,period,activity_type,amount,unit,emission_factor_id,calculated_co2e,source_file\n');
  });
  it('toGhgMarkdown shows total and per-category in tCO2e', () => {
    const md = toGhgMarkdown(FIX, '2025');
    expect(md).toContain('盤點年度：2025');
    expect(md).toContain('已核定筆數：2');
    expect(md).toContain('0.194'); // (50+144)/1000
    expect(md).toContain('| Category 1 | 0.050 |');
    expect(md).toContain('| Category 4 | 0.144 |');
  });
  it('matches the tenant-template .mjs output (cross-source consistency)', () => {
    expect(toCsv(FIX)).toBe(mjsToCsv(FIX));
    // 去掉末尾「自動產生於 <ISO 時間>」行後比對（時間戳每次不同）
    const norm = (s: string) => s.replace(/自動產生於 .*$/m, '自動產生於 X');
    expect(norm(toGhgMarkdown(FIX, '2025'))).toBe(norm(mjsToGhg(FIX, '2025')));
  });
});
```

- [ ] **Step 2：執行確認失敗**

Run: `cd /Users/lightman/yao.care/agent.scope3esg/scope3-worker && pnpm vitest run --config vitest.middleware.config.ts tests/lib/report.test.ts`
Expected: FAIL（`src/lib/report` 不存在）

- [ ] **Step 3：實作 `src/lib/report.ts`**（邏輯與 .mjs 逐字一致，改 TS 型別）

```typescript
// src/lib/report.ts
// 報表純函式（CSV + GHG Markdown）。邏輯與 tenant-template/scripts/report-lib.mjs 一致，
// 兩份須同步維護（見 tests/lib/report.test.ts 的交叉一致性測試）。
const CSV_COLUMNS = [
  'submission_id', 'supplier_id', 'scope3_category', 'period',
  'activity_type', 'amount', 'unit', 'emission_factor_id',
  'calculated_co2e', 'source_file',
];

function escapeCsv(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function toCsv(submissions: Record<string, unknown>[]): string {
  const subs = Array.isArray(submissions) ? submissions : [];
  const header = CSV_COLUMNS.join(',');
  const rows = subs.map((s) => CSV_COLUMNS.map((c) => escapeCsv(s[c])).join(','));
  return [header, ...rows].join('\n') + '\n';
}

export function toGhgMarkdown(submissions: Record<string, unknown>[], year: string | number): string {
  const subs = Array.isArray(submissions) ? submissions : [];
  let total = 0;
  const byCat: Record<string, number> = {};
  for (const s of subs) {
    const co2e = Number(s.calculated_co2e) || 0;
    total += co2e;
    const cat = String(s.scope3_category);
    byCat[cat] = (byCat[cat] || 0) + co2e;
  }
  const catLines = Object.keys(byCat)
    .sort((a, b) => Number(a) - Number(b))
    .map((c) => `| Category ${c} | ${(byCat[c] / 1000).toFixed(3)} |`)
    .join('\n');

  return `# Scope 3 排放報告 ${year}

依 GHG Protocol Corporate Value Chain (Scope 3) Standard 編製。

## 總覽

- 盤點年度：${year}
- 已核定筆數：${subs.length}
- **Scope 3 總排放量：${(total / 1000).toFixed(3)} tCO₂e（${total.toFixed(1)} kgCO₂e）**

## 各類別排放量（tCO₂e）

| Scope 3 類別 | 排放量 |
|------|------|
${catLines || '| — | 0.000 |'}

---
本報告由 Scope3 GitHub App 自動產生於 ${new Date().toISOString()}。
`;
}
```

- [ ] **Step 4：執行確認通過**

Run: `pnpm vitest run --config vitest.middleware.config.ts tests/lib/report.test.ts`
Expected: PASS（含交叉一致性）

- [ ] **Step 5：Commit**

```bash
cd /Users/lightman/yao.care/agent.scope3esg
git add scope3-worker/src/lib/report.ts scope3-worker/tests/lib/report.test.ts
git commit -m "$(printf 'feat: port report-lib (toCsv/toGhgMarkdown) into Worker as src/lib/report.ts\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>')"
```

---

### Task 2：`dashboard-data` 加 `?year=` 過濾與 `availableYears`

**Files:**
- Modify: `scope3-worker/src/routes/admin-api.ts`（`dashboard-data` handler）
- Test: `scope3-worker/tests/routes/admin-api.test.ts`

- [ ] **Step 1：寫失敗測試**（沿用既有 mock 範式；mock readAggregatedSubmissions 的來源——即 `GET contents data/submissions.json` 回兩筆不同年份的記錄）

新增案例：
```typescript
it('GET /:org/dashboard-data returns availableYears and filters by year', async () => {
  // mock data/submissions.json 內含 period 2025-Q1 與 2024-Q3 各一筆
  const all = await appFetch('/api/v1/admin/acme/dashboard-data', { headers: { Cookie: validSessionCookie } });
  const allBody = await all.json();
  expect(allBody.availableYears.sort()).toEqual(['2024', '2025']);
  expect(allBody.submissionCount).toBe(2);

  const y = await appFetch('/api/v1/admin/acme/dashboard-data?year=2025', { headers: { Cookie: validSessionCookie } });
  expect((await y.json()).submissionCount).toBe(1);
});
```
（mock 細節對齊既有 dashboard-data 測試如何 mock `GET contents data/submissions.json`。）

- [ ] **Step 2：執行確認失敗**

Run: `pnpm vitest run tests/routes/admin-api.test.ts`
Expected: FAIL（無 availableYears／未過濾）

- [ ] **Step 3：改 `dashboard-data` handler**

把現有 `dashboard-data` handler 改為（保留既有 tenant/octokit 取得與 `readAggregatedSubmissions`）：
```typescript
adminApi.get('/:org/dashboard-data', async (c) => {
  const { org } = c.req.param();
  const year = c.req.query('year');
  const tenant = await getTenantByOrg(c.env.DB, org);
  if (!tenant) return c.json({ error: 'unknown org' }, 404);
  const octokit = await getInstallationOctokit(c.env, tenant.installationId);
  const all = await readAggregatedSubmissions(octokit, org);
  const availableYears = [...new Set(all.map((s: any) => String(s.period ?? '').slice(0, 4)).filter(Boolean))].sort();
  const submissions = year ? all.filter((s: any) => String(s.period ?? '').slice(0, 4) === year) : all;
  return c.json({ ...aggregateKpis(submissions), availableYears });
});
```
（`aggregateKpis` 已 import；型別上 `readAggregatedSubmissions` 回 any[]，filter 用 `(s: any)`。）

- [ ] **Step 4：執行確認通過**

Run: `pnpm vitest run tests/routes/admin-api.test.ts`
Expected: PASS

- [ ] **Step 5：Commit**

```bash
cd /Users/lightman/yao.care/agent.scope3esg
git add scope3-worker/src/routes/admin-api.ts scope3-worker/tests/routes/admin-api.test.ts
git commit -m "$(printf 'feat: dashboard-data year filter and availableYears\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>')"
```

---

### Task 3：報表 API `GET /:org/reports?year=&format=csv|md`

**Files:**
- Modify: `scope3-worker/src/routes/admin-api.ts`（新增端點＋import report）
- Test: `scope3-worker/tests/routes/admin-api.test.ts`

- [ ] **Step 1：寫失敗測試**
```typescript
it('GET /:org/reports?format=csv returns CSV attachment', async () => {
  const res = await appFetch('/api/v1/admin/acme/reports?format=csv', { headers: { Cookie: validSessionCookie } });
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/csv');
  expect(res.headers.get('content-disposition')).toContain('attachment');
  expect(await res.text()).toContain('submission_id,supplier_id');
});
it('GET /:org/reports?format=md&year=2025 returns markdown filtered by year', async () => {
  const res = await appFetch('/api/v1/admin/acme/reports?format=md&year=2025', { headers: { Cookie: validSessionCookie } });
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/markdown');
  const body = await res.text();
  expect(body).toContain('盤點年度：2025');
});
```

- [ ] **Step 2：執行確認失敗**

Run: `pnpm vitest run tests/routes/admin-api.test.ts`
Expected: FAIL（端點不存在）

- [ ] **Step 3：實作端點**（import 補 `import { toCsv, toGhgMarkdown } from '../lib/report';`），於 dashboard-data 之後新增：
```typescript
adminApi.get('/:org/reports', async (c) => {
  const { org } = c.req.param();
  const year = c.req.query('year');
  const format = c.req.query('format') ?? 'md';
  const tenant = await getTenantByOrg(c.env.DB, org);
  if (!tenant) return c.json({ error: 'unknown org' }, 404);
  const octokit = await getInstallationOctokit(c.env, tenant.installationId);
  const all = await readAggregatedSubmissions(octokit, org);
  const submissions = year ? all.filter((s: any) => String(s.period ?? '').slice(0, 4) === year) : all;
  if (format === 'csv') {
    return new Response(toCsv(submissions), {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="scope3-report-${year || 'all'}.csv"` },
    });
  }
  return new Response(toGhgMarkdown(submissions, year || 'all'), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
});
```

- [ ] **Step 4：執行確認通過**

Run: `pnpm vitest run tests/routes/admin-api.test.ts`
Expected: PASS

- [ ] **Step 5：Commit**

```bash
cd /Users/lightman/yao.care/agent.scope3esg
git add scope3-worker/src/routes/admin-api.ts scope3-worker/tests/routes/admin-api.test.ts
git commit -m "$(printf 'feat: reports API (csv/md, year filter) generating from submissions.json\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>')"
```

---

### Task 4：報表頁 `/admin/:org/reports` ＋ 路由註冊

**Files:**
- Create: `scope3-worker/src/admin/reports-page.ts`（`reportsPageHtml(org)`）
- Modify: `scope3-worker/src/routes/admin.ts`（註冊 `GET /:org/reports`，session 保護，比照 `/:org/review`）

- [ ] **Step 1：建立 `src/admin/reports-page.ts`**

```typescript
// src/admin/reports-page.ts
import { renderNav } from '../ui/nav';

export function reportsPageHtml(org: string): string {
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Scope 3 報表 — ${org}</title><link rel="stylesheet" href="/assets/app.css"></head>
<body>
${renderNav(org, 'reports')}
<div class="container">
<h1>報表 — ${org}</h1>
<section class="card">
  <label class="label">盤點年度</label>
  <select class="select" id="year" style="max-width:200px"></select>
  <p><a class="btn btn-primary" id="dl-csv" href="#">下載 CSV</a></p>
</section>
<section class="card"><h2>GHG 總覽</h2><div class="kpis" id="kpis"></div><div id="by-category"></div></section>
</div>
<script>
var ORG = ${JSON.stringify(org)};
var CAT_NAMES = ['採購商品與服務','資本財','燃料與能源','上游運輸配送','營運廢棄物','商務旅行','員工通勤','上游租賃資產','下游運輸配送','售出產品加工','售出產品使用','售出產品報廢','下游租賃資產','加盟','投資'];
function fmt(n){ return Number(n).toLocaleString('en-US',{maximumFractionDigits:3}); }
function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function bars(id, rows){ var el=document.getElementById(id); if(!rows.length){ el.innerHTML='<div class="muted">尚無資料</div>'; return; }
  var max=Math.max.apply(null, rows.map(function(r){return r.value;}).concat([1]));
  el.innerHTML=rows.map(function(r){ var pct=(r.value/max)*100; return '<div class="bar-row"><span class="name">'+esc(r.name)+'</span><span class="bar-track"><span class="bar-fill" style="width:'+pct+'%"></span></span><span class="num">'+fmt(r.value/1000)+'</span></div>'; }).join(''); }
function setDl(){ var y=document.getElementById('year').value; document.getElementById('dl-csv').href='/api/v1/admin/'+ORG+'/reports?format=csv'+(y?'&year='+encodeURIComponent(y):''); }
function loadData(){
  var y=document.getElementById('year').value;
  fetch('/api/v1/admin/'+ORG+'/dashboard-data'+(y?'?year='+encodeURIComponent(y):'')).then(function(r){return r.json();}).then(function(k){
    document.getElementById('kpis').innerHTML='<div class="card"><div class="muted">Total Scope 3</div><div class="kpi-value">'+fmt(k.totalCo2e/1000)+' <span class="kpi-unit">tCO₂e</span></div></div>'+
      '<div class="card"><div class="muted">已核定筆數</div><div class="kpi-value">'+k.submissionCount+' <span class="kpi-unit">筆</span></div></div>';
    bars('by-category', Object.keys(k.byCategory).map(function(cat){return {name:'Cat.'+cat+' '+(CAT_NAMES[cat-1]||''), value:k.byCategory[cat]};}).sort(function(a,b){return b.value-a.value;}));
    setDl();
  });
}
fetch('/api/v1/admin/'+ORG+'/dashboard-data').then(function(r){return r.json();}).then(function(k){
  var ys=(k.availableYears||[]); var sel=document.getElementById('year');
  sel.innerHTML='<option value="">全部年度</option>'+ys.map(function(y){return '<option value="'+esc(y)+'">'+esc(y)+'</option>';}).join('');
  sel.addEventListener('change', loadData);
  loadData();
});
</script>
</body></html>`;
}
```

- [ ] **Step 2：在 `src/routes/admin.ts` 註冊 `GET /:org/reports`**

import 補：`import { reportsPageHtml } from '../admin/reports-page';`
在 `admin.get('/:org/review', …)` 之後新增：
```typescript
admin.get('/:org/reports', async (c) => {
  const { org } = c.req.param();
  const cookie = readCookie(c, SESSION_COOKIE);
  const session = cookie ? await verifySession(cookie, c.env.SESSION_SECRET) : null;
  if (!session || session.org !== org) {
    return c.redirect(`/admin/${org}/login`);
  }
  return c.html(reportsPageHtml(org));
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
git add scope3-worker/src/admin/reports-page.ts scope3-worker/src/routes/admin.ts
git commit -m "$(printf 'feat: reports page at /admin/:org/reports with year selector and CSV download\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>')"
```

---

### Task 5：儀表板加年份下拉

**Files:**
- Modify: `scope3-worker/src/routes/dashboard.ts`（`dashboardHtml` 加年份下拉並依選年重抓 dashboard-data）

- [ ] **Step 1：在 `dashboardHtml` 的 `<h1>` 之後、`#subtitle` 之前插入年份下拉**

```html
<label class="label">盤點年度 <select class="select" id="year" style="max-width:200px;display:inline-block"></select></label>
```

- [ ] **Step 2：改前端 JS 支援年份切換**

把現有 `fetch('/api/v1/admin/'+ORG+'/dashboard-data')...` 的載入邏輯包成 `function loadDash(){ var y=document.getElementById('year').value; fetch('/api/v1/admin/'+ORG+'/dashboard-data'+(y?'?year='+encodeURIComponent(y):''))... }`（原本的 `.then` 渲染邏輯搬進 loadDash），並在最前面先抓一次取 `availableYears` 填下拉：
```javascript
fetch('/api/v1/admin/'+ORG+'/dashboard-data').then(function(r){return r.json();}).then(function(k){
  var sel=document.getElementById('year');
  sel.innerHTML='<option value="">全部年度</option>'+(k.availableYears||[]).map(function(y){return '<option value="'+y+'">'+y+'</option>';}).join('');
  sel.addEventListener('change', loadDash);
  loadDash();
});
```
（loadDash 內維持既有 subtitle/kpis/bars 渲染；只把 fetch URL 改為帶 year。）

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
git add scope3-worker/src/routes/dashboard.ts
git commit -m "$(printf 'feat: dashboard year selector\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>')"
```

---

## 驗收（Plan 4 完成標準）

- `pnpm test` 兩 pool 全綠、`tsc` src clean。
- `src/lib/report.ts` 的 toCsv/toGhgMarkdown 有單元測試＋與 .mjs 的交叉一致性測試（normalize 時間戳後逐字相等）。
- `dashboard-data` 回 `availableYears`、`?year=` 過濾正確。
- `GET /:org/reports?format=csv` 回 CSV attachment、`?format=md` 回 markdown、`?year=` 過濾。
- `/admin/:org/reports` 頁（session 保護）：年份下拉、GHG 總覽（總量＋各類別）、下載 CSV 鈕；導覽列 active=reports（「報表」連結不再 404）。
- 儀表板年份下拉可切換重算。
- （部署後人工檢查）登入 `/admin/yao-care/reports`：選年度→總覽更新→下載 CSV 內容正確；儀表板切年度。
