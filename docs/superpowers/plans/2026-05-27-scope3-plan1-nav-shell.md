# Manager 工作台 Plan 1：導覽骨架＋登出 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 為四個 Manager 頁面（設定／審核／儀表板／報表）加上共用頂部導覽列、登出鈕、與「審核」待審筆數 badge。

**Architecture:** 導覽列 HTML 由新檔 `src/ui/nav.ts` 的 `renderNav(org, active)` 產生（含自帶的 badge fetch 與登出 inline script）；對應 CSS 加在唯一 CSS 來源 `src/ui/theme.mjs`（職責分離：HTML 在 nav.ts、CSS 在 theme.mjs）。待審數由新輕量端點 `GET /api/v1/admin/:org/review/count` 提供（`sub/` ＋ `withdraw/` open PR 數）。現有 `/admin/:org`、`/dashboard/:org` 兩頁套用導覽列。

**Tech Stack:** TypeScript、Hono、Cloudflare Workers、Vitest（兩 pool：`test:cf` Cloudflare、`test:node` Node）、pnpm。

**對應 spec：** `docs/superpowers/specs/2026-05-27-scope3-manager-workbench-design.md` 區塊 1。

**注意事項：**
- 導覽列固定列出 4 項；`審核`／`報表` 頁面在 Plan 2／Plan 4 才實作，Plan 1 完成後點這兩項會暫時 404（開發中正常，不影響設定／儀表板）。
- 套件管理一律 **pnpm**。提交訊息結尾需附 `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`。
- 工作目錄：`/Users/lightman/yao.care/agent.scope3esg/scope3-worker/`；git root：`/Users/lightman/yao.care/agent.scope3esg/`。
- 直接在 `main` 開發；**本計畫各 Task 只 commit、不 push**（整個 Plan 1 完成驗收後再由控制者決定部署）。

---

### Task 1：`renderNav` 純函式（HTML 導覽列）

**Files:**
- Create: `scope3-worker/src/ui/nav.ts`
- Test: `scope3-worker/tests/lib/nav.test.ts`（Node pool；純字串函式，不需 Cloudflare runtime）

- [ ] **Step 1：寫失敗測試**

`scope3-worker/tests/lib/nav.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { renderNav } from '../../src/ui/nav';

describe('renderNav', () => {
  it('renders four nav links with org-scoped hrefs', () => {
    const html = renderNav('acme', 'config');
    expect(html).toContain('href="/admin/acme"');
    expect(html).toContain('href="/admin/acme/review"');
    expect(html).toContain('href="/dashboard/acme"');
    expect(html).toContain('href="/admin/acme/reports"');
  });

  it('marks the active item with the active class', () => {
    expect(renderNav('acme', 'dashboard')).toMatch(/class="nav-link active" href="\/dashboard\/acme"/);
    expect(renderNav('acme', 'config')).toMatch(/class="nav-link active" href="\/admin\/acme"/);
  });

  it('includes logout button and pending badge placeholder', () => {
    const html = renderNav('acme', 'config');
    expect(html).toContain('id="nav-logout"');
    expect(html).toContain('id="nav-pending"');
  });

  it('fetches the review count and posts logout for the given org', () => {
    const html = renderNav('acme', 'config');
    expect(html).toContain("/api/v1/admin/'+org+'/review/count");
    expect(html).toContain("/admin/'+org+'/logout");
    expect(html).toContain('"acme"'); // org 以 JSON.stringify 注入 script
  });

  it('escapes org in attribute context', () => {
    const html = renderNav('a"b', 'config');
    expect(html).not.toContain('href="/admin/a"b"');
  });
});
```

- [ ] **Step 2：執行測試確認失敗**

Run: `cd /Users/lightman/yao.care/agent.scope3esg/scope3-worker && pnpm vitest run --config vitest.middleware.config.ts tests/lib/nav.test.ts`
Expected: FAIL（`Cannot find module '../../src/ui/nav'`）

- [ ] **Step 3：實作 `src/ui/nav.ts`**

```typescript
// src/ui/nav.ts
// Manager 工作台共用導覽列（輸出 HTML）。對應 CSS（.nav*）在 src/ui/theme.mjs。
// 與 theme.mjs 分離：theme.mjs 只負責全站 CSS，本檔負責導覽列 HTML 結構。

type NavKey = 'config' | 'review' | 'dashboard' | 'reports';

const NAV_ITEMS: Array<{ key: NavKey; label: string; href: (org: string) => string }> = [
  { key: 'config',    label: '設定',   href: (org) => `/admin/${org}` },
  { key: 'review',    label: '審核',   href: (org) => `/admin/${org}/review` },
  { key: 'dashboard', label: '儀表板', href: (org) => `/dashboard/${org}` },
  { key: 'reports',   label: '報表',   href: (org) => `/admin/${org}/reports` },
];

function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderNav(org: string, active: NavKey): string {
  const o = escAttr(org);
  const links = NAV_ITEMS.map((it) => {
    const cls = it.key === active ? 'nav-link active' : 'nav-link';
    const badge = it.key === 'review' ? '<span class="badge nav-pending" id="nav-pending" hidden></span>' : '';
    return `<a class="${cls}" href="${it.href(o)}">${it.label}${badge}</a>`;
  }).join('');
  return `<nav class="nav">
  <span class="nav-brand">Scope3 ▸ ${o}</span>
  <span class="nav-links">${links}</span>
  <button class="btn btn-secondary nav-logout" id="nav-logout" type="button">登出</button>
</nav>
<script>
(function(){
  var org=${JSON.stringify(org)};
  fetch('/api/v1/admin/'+org+'/review/count').then(function(r){return r.json();}).then(function(d){
    var b=document.getElementById('nav-pending');
    if(b && d && d.pending>0){ b.textContent=d.pending; b.hidden=false; }
  }).catch(function(){});
  var lo=document.getElementById('nav-logout');
  if(lo) lo.addEventListener('click', function(){
    fetch('/admin/'+org+'/logout',{method:'POST'}).then(function(){ location.href='/admin/'+org+'/login'; });
  });
})();
</script>`;
}
```

- [ ] **Step 4：執行測試確認通過**

Run: `cd /Users/lightman/yao.care/agent.scope3esg/scope3-worker && pnpm vitest run --config vitest.middleware.config.ts tests/lib/nav.test.ts`
Expected: PASS（5 個案例）

- [ ] **Step 5：Commit**

```bash
cd /Users/lightman/yao.care/agent.scope3esg
git add scope3-worker/src/ui/nav.ts scope3-worker/tests/lib/nav.test.ts
git commit -m "$(printf 'feat: add renderNav shared nav component (HTML in nav.ts)\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>')"
```

---

### Task 2：導覽列 CSS（加在 theme.mjs）

**Files:**
- Modify: `scope3-worker/src/ui/theme.mjs`（在 `APP_CSS` 字串末尾、結尾反引號前追加）

- [ ] **Step 1：在 `theme.mjs` 的 `APP_CSS` 末尾追加導覽列樣式**

在 `src/ui/theme.mjs` 中，找到 `footer { ... }` 那一行（目前 APP_CSS 的最後一條規則），在它之後、結尾的反引號 `` ` `` 之前，插入：

```css
.nav { display: flex; align-items: center; gap: 16px; background: var(--surface); border-bottom: 1px solid var(--border); padding: 12px 24px; }
.nav-brand { font-weight: 700; color: var(--primary); font-size: var(--text-sm); }
.nav-links { display: flex; gap: 4px; flex: 1; }
.nav-link { padding: 6px 12px; border-radius: 4px; color: var(--fg); text-decoration: none; font-size: var(--text-sm); }
.nav-link:hover { background: var(--primary-weak); }
.nav-link.active { background: var(--primary-weak); color: var(--primary); font-weight: 600; }
.nav-pending { margin-left: 6px; background: var(--danger); color: var(--primary-fg); }
.nav-logout { flex-shrink: 0; }
```

- [ ] **Step 2：確認 build:templates 不受影響（theme.mjs 仍只 export CSS）**

Run: `cd /Users/lightman/yao.care/agent.scope3esg/scope3-worker && pnpm run build:templates && pnpm tsc --noEmit 2>&1 | grep -E "^src/" || echo "src clean"`
Expected: build 正常列出檔案、`src clean`（純 CSS 變更不影響型別）。

- [ ] **Step 3：Commit**

```bash
cd /Users/lightman/yao.care/agent.scope3esg
git add scope3-worker/src/ui/theme.mjs scope3-worker/src/templates/generated.ts
git commit -m "$(printf 'feat: add nav bar CSS tokens to theme.mjs\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>')"
```

---

### Task 3：待審筆數端點 `GET /api/v1/admin/:org/review/count`

**Files:**
- Modify: `scope3-worker/src/routes/admin-api.ts`（新增端點；該檔已 import `getTenantByOrg`、`getInstallationOctokit`、`listOpenPullRequestsByPrefix`）
- Test: `scope3-worker/tests/routes/admin-api.test.ts`（CF pool；比照既有 mock 範式新增案例）

- [ ] **Step 1：閱讀既有測試的 mock 範式**

Run: `cd /Users/lightman/yao.care/agent.scope3esg/scope3-worker && sed -n '1,60p' tests/routes/admin-api.test.ts`
目的：沿用既有對 `getTenantByOrg`／`getInstallationOctokit`／session cookie 的 mock 方式（不要自創新模式）。

- [ ] **Step 2：寫失敗測試（沿用既有 mock 範式，新增以下案例）**

在 `tests/routes/admin-api.test.ts` 既有 describe 內新增。mock 的 octokit `request` 對 `GET /repos/{owner}/{repo}/pulls` 依 `params.head`／既有清單 mock 回傳：`sub/` 前綴回 2 筆、`withdraw/` 前綴回 1 筆（比照既有測試如何 mock `listOpenPullRequestsByPrefix` 的底層 `request`）。斷言：

```typescript
it('GET /:org/review/count returns pending = open sub/ + withdraw/ PR count', async () => {
  // 既有測試的 app/fetch helper 與 session cookie 沿用；octokit mock 令
  // listOpenPullRequestsByPrefix(org,'sub/') 回 2 筆、('withdraw/') 回 1 筆。
  const res = await appFetch(`/api/v1/admin/acme/review/count`, { headers: { Cookie: validSessionCookie } });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ pending: 3 });
});
```

> 註：`appFetch`／`validSessionCookie` 請對應既有測試檔中已存在的 helper 名稱；若名稱不同，沿用該檔實際的呼叫方式。

- [ ] **Step 3：執行測試確認失敗**

Run: `cd /Users/lightman/yao.care/agent.scope3esg/scope3-worker && pnpm vitest run tests/routes/admin-api.test.ts`
Expected: FAIL（404 或 pending 非 3，因端點尚未存在）

- [ ] **Step 4：實作端點**

在 `src/routes/admin-api.ts`，於既有 `adminApi.get('/:org/overview', …)` 之後新增（`listOpenPullRequestsByPrefix` 已在該檔 import；若無則從 `'../github/pr'` 補上）：

```typescript
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
```

- [ ] **Step 5：執行測試確認通過**

Run: `cd /Users/lightman/yao.care/agent.scope3esg/scope3-worker && pnpm vitest run tests/routes/admin-api.test.ts`
Expected: PASS

- [ ] **Step 6：Commit**

```bash
cd /Users/lightman/yao.care/agent.scope3esg
git add scope3-worker/src/routes/admin-api.ts scope3-worker/tests/routes/admin-api.test.ts
git commit -m "$(printf 'feat: add review/count endpoint for nav pending badge\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>')"
```

---

### Task 4：兩個現有頁面套用導覽列

**Files:**
- Modify: `scope3-worker/src/admin/page.ts`（`adminPageHtml` 注入 `renderNav(org,'config')`）
- Modify: `scope3-worker/src/routes/dashboard.ts`（`dashboardHtml` 注入 `renderNav(org,'dashboard')`）

- [ ] **Step 1：`admin/page.ts` 引入並注入導覽列**

在 `src/admin/page.ts` 檔首 `export function` 之前加 import：

```typescript
import { renderNav } from '../ui/nav';
```

把 `<body>` 之後、`<div class="container">` 之前改成（即在 container 外、body 內最上方放導覽列）：

```html
<body>
${renderNav(org, 'config')}
<div class="container">
```

（其餘內容不動。）

- [ ] **Step 2：`routes/dashboard.ts` 引入並注入導覽列**

在 `src/routes/dashboard.ts` 檔首加 import：

```typescript
import { renderNav } from '../ui/nav';
```

把 `dashboardHtml` 內 `<body>` 之後、`<div class="container">` 之前改成：

```html
<body>
${renderNav(org, 'dashboard')}
<div class="container">
```

- [ ] **Step 3：型別檢查 ＋ 全套測試**

Run:
```bash
cd /Users/lightman/yao.care/agent.scope3esg/scope3-worker
pnpm tsc --noEmit 2>&1 | grep -E "^src/" || echo "src clean"
pnpm test 2>&1 | grep -E "Test Files|Tests |failed|FAIL"
```
Expected: `src clean`；兩個 pool 全綠（含 Task 1 的 nav 測試與 Task 3 的 count 測試）。

- [ ] **Step 4：Commit**

```bash
cd /Users/lightman/yao.care/agent.scope3esg
git add scope3-worker/src/admin/page.ts scope3-worker/src/routes/dashboard.ts
git commit -m "$(printf 'feat: apply shared nav to admin and dashboard pages\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>')"
```

---

## 驗收（Plan 1 完成標準）

- `pnpm test` 兩 pool 全綠、`tsc` src clean。
- `src/ui/nav.ts` 的 `renderNav` 輸出 4 連結（設定／審核／儀表板／報表）、active 標記、登出鈕、待審 badge placeholder＋自帶 fetch/logout script。
- `theme.mjs` 含 `.nav*` 樣式；`build:templates` 正常。
- `GET /api/v1/admin/:org/review/count` 回 `{pending}`＝`sub/`＋`withdraw/` open PR 數。
- `/admin/:org`、`/dashboard/:org` 兩頁頂部出現導覽列；登出鈕可清 session 並導回 login。
- （部署後人工檢查）登入 `/admin/yao-care`，導覽列顯示、登出可用；`審核`／`報表` 連結點擊暫 404（Plan 2／4 補上）。
