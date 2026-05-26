# Scope 3 GitHub App — Plan 6: 統一設計系統

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立單一 CSS 來源（oklch 配色 + 字級規範 + 共用元件 class），由 Worker `/assets/app.css` 與儀表板 `docs/app.css` 兩管道輸出，並重構 admin / 填表 / 成功頁 / 儀表板套用，移除各自 inline CSS。

**Architecture:** `src/ui/theme.mjs` export `APP_CSS`（純 JS 字串，Node 與 Worker 共用）。Worker 新增 `/assets/app.css` 路由；`build-templates.mjs` 額外輸出 `tenant-template/docs/app.css`。各頁改 `<link>` 引用、HTML 換成共用 class。

**Tech Stack:** Vanilla CSS（oklch、CSS 變數）、Hono、Vitest

---

## Task 1: CSS 來源 theme.mjs

**Files:** Create `scope3-worker/src/ui/theme.mjs`

- [ ] **Step 1: 建立 `src/ui/theme.mjs`**

```javascript
// src/ui/theme.mjs
// 全站唯一 CSS 來源。純 JS 字串，供 Worker（/assets/app.css）與 build-templates（docs/app.css）共用。
export const APP_CSS = `:root {
  --bg: oklch(0.985 0.004 250);
  --surface: oklch(1 0 0);
  --fg: oklch(0.27 0.02 255);
  --muted: oklch(0.55 0.02 255);
  --border: oklch(0.92 0.008 255);
  --primary: oklch(0.58 0.17 256);
  --primary-fg: oklch(0.99 0 0);
  --primary-weak: oklch(0.95 0.03 256);
  --danger: oklch(0.57 0.19 27);
  --success: oklch(0.60 0.14 150);
  --warning: oklch(0.75 0.15 85);
  --font: -apple-system, "Segoe UI", "Noto Sans TC", sans-serif;
  --text-xs: .78rem;
  --text-sm: .88rem;
  --text-base: 1rem;
  --text-lg: 1.15rem;
  --text-xl: 1.4rem;
  --leading: 1.5;
  --radius: 8px;
  --gap: 16px;
}
* { box-sizing: border-box; }
body { font-family: var(--font); font-size: var(--text-base); line-height: var(--leading); color: var(--fg); background: var(--bg); margin: 0; }
.container { max-width: 960px; margin: 0 auto; padding: 24px; }
h1 { font-size: var(--text-xl); margin: 0 0 16px; }
h2 { font-size: var(--text-lg); margin: 0 0 16px; }
p { margin: 8px 0; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px; margin-bottom: 20px; }
.label { display: block; font-size: var(--text-sm); color: var(--muted); margin: 12px 0 4px; }
.input, .select { width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: 4px; font-size: var(--text-base); background: var(--surface); color: var(--fg); }
.row { display: flex; gap: 12px; }
.row > * { flex: 1; }
.btn { padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; font-size: var(--text-sm); }
.btn-primary { background: var(--primary); color: var(--primary-fg); }
.btn-secondary { background: var(--border); color: var(--fg); }
.btn-danger { background: var(--danger); color: var(--primary-fg); }
.btn-lg { padding: 12px 32px; font-size: var(--text-base); }
.table { width: 100%; border-collapse: collapse; font-size: var(--text-sm); }
.table th, .table td { text-align: left; padding: 6px; border-bottom: 1px solid var(--border); }
.table td input { width: 100%; }
.muted { color: var(--muted); font-size: var(--text-sm); }
.badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: var(--text-xs); background: var(--primary-weak); color: var(--primary); }
.cats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; font-size: var(--text-sm); }
.bar-row { display: flex; align-items: center; gap: 12px; margin: 8px 0; font-size: var(--text-sm); }
.bar-row .name { width: 160px; flex-shrink: 0; color: var(--muted); }
.bar-track { flex: 1; background: var(--primary-weak); border-radius: 4px; overflow: hidden; height: 22px; }
.bar-fill { height: 100%; background: var(--primary); }
.bar-row .num { width: 110px; text-align: right; flex-shrink: 0; font-variant-numeric: tabular-nums; }
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: var(--gap); }
.kpi-value { font-size: 1.8rem; font-weight: 700; margin-top: 6px; }
.kpi-unit { font-size: var(--text-sm); color: var(--muted); font-weight: 400; }
.supplier-note { color: var(--muted); font-size: var(--text-sm); margin-bottom: 24px; }
.success-box { max-width: 480px; margin: 80px auto; text-align: center; }
.success-box h1 { color: var(--success); }
.toast { position: fixed; top: 16px; right: 16px; background: var(--success); color: var(--primary-fg); padding: 12px 20px; border-radius: 4px; display: none; }
code { background: var(--primary-weak); padding: 2px 4px; border-radius: 3px; font-size: var(--text-xs); word-break: break-all; }
footer { text-align: center; color: var(--muted); font-size: var(--text-xs); padding: 24px; }
`;
```

- [ ] **Step 2: 確認語法**

```bash
cd /Users/lightman/yao.care/agent.scope3esg/scope3-worker
node --check src/ui/theme.mjs && echo "OK"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
cd /Users/lightman/yao.care/agent.scope3esg
git add scope3-worker/src/ui/theme.mjs
git commit -m "feat: add single-source design system CSS (oklch tokens)"
```

---

## Task 2: /assets/app.css 路由（TDD）

**Files:** Create `scope3-worker/src/routes/assets.ts`、`scope3-worker/tests/routes/assets.test.ts`；Modify `src/index.ts`

- [ ] **Step 1: 建立失敗的測試 `tests/routes/assets.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../../src/index';

describe('GET /assets/app.css', () => {
  it('serves CSS with correct content-type and tokens', async () => {
    const res = await app.request('/assets/app.css', {}, env as any);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/css');
    const body = await res.text();
    expect(body).toContain(':root');
    expect(body).toContain('--primary');
    expect(body).toContain('oklch');
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

```bash
cd /Users/lightman/yao.care/agent.scope3esg/scope3-worker
pnpm vitest run tests/routes/assets.test.ts 2>&1 | tail -10
```

Expected: FAIL（404）

- [ ] **Step 3: 建立 `src/routes/assets.ts`**

```typescript
// src/routes/assets.ts
import { Hono } from 'hono';
import type { Bindings, Variables } from '../types';
import { APP_CSS } from '../ui/theme.mjs';

const assets = new Hono<{ Bindings: Bindings; Variables: Variables }>();

assets.get('/app.css', (c) => {
  return c.body(APP_CSS, 200, {
    'Content-Type': 'text/css; charset=utf-8',
    'Cache-Control': 'public, max-age=3600',
  });
});

export default assets;
```

- [ ] **Step 4: 在 `src/index.ts` 掛載**

加 `import assetsRoute from './routes/assets';`，並在其他 app.route 之間加 `app.route('/assets', assetsRoute);`（export 前）。

- [ ] **Step 5: 執行測試確認通過**

```bash
pnpm vitest run tests/routes/assets.test.ts 2>&1 | tail -10
```

Expected: PASS

- [ ] **Step 6: 確認 tsc（.mjs import）**

```bash
pnpm tsc --noEmit 2>&1 | grep -E "^src/" || echo "src clean"
```

若出現 `theme.mjs` 找不到型別宣告的錯誤，在 `src/routes/assets.ts` 的 import 上一行加 `// @ts-expect-error theme.mjs is plain JS`，或在 tsconfig 開 `allowJs`。優先用 `allowJs: true`（tsconfig.json 的 compilerOptions）若已存在則無需改。

- [ ] **Step 7: Commit**

```bash
cd /Users/lightman/yao.care/agent.scope3esg
git add scope3-worker/src/routes/assets.ts scope3-worker/tests/routes/assets.test.ts scope3-worker/src/index.ts scope3-worker/tsconfig.json
git commit -m "feat: serve unified app.css at /assets/app.css"
```

---

## Task 3: build-templates 輸出 docs/app.css

**Files:** Modify `scope3-worker/scripts/build-templates.mjs`

- [ ] **Step 1: 讀取現有 `scripts/build-templates.mjs`，在 walk 之後、寫 generated.ts 之前，加入輸出 docs/app.css**

在檔案頂端 import：
```javascript
import { APP_CSS } from '../src/ui/theme.mjs';
```

在 `walk(ROOT);` 之後加入（把 APP_CSS 寫進 tenant-template/docs/app.css，使其一併被打包進 generated.ts）：
```javascript
// 將設計系統 CSS 寫入儀表板目錄，與 Worker 共用同一 APP_CSS
writeFileSync(join(ROOT, 'docs', 'app.css'), APP_CSS);
// 重新 walk 以納入剛寫入的 app.css
for (const k of Object.keys(files)) delete files[k];
walk(ROOT);
```

注意：確認 `writeFileSync` 與 `join` 已 import（現有 build-templates 應已有）。`tenant-template/docs/` 目錄已存在。

- [ ] **Step 2: 執行打包確認 app.css 產生**

```bash
cd /Users/lightman/yao.care/agent.scope3esg/scope3-worker
pnpm run build:templates 2>&1 | grep "docs/app.css"
test -f tenant-template/docs/app.css && echo "app.css written"
```

Expected: 輸出含 `docs/app.css`、`app.css written`

- [ ] **Step 3: Commit**

```bash
cd /Users/lightman/yao.care/agent.scope3esg
git add scope3-worker/scripts/build-templates.mjs scope3-worker/tenant-template/docs/app.css scope3-worker/src/templates/generated.ts
git commit -m "feat: emit shared app.css into tenant docs from build-templates"
```

---

## Task 4: 重構 admin 管理頁

**Files:** Modify `scope3-worker/src/admin/page.ts`

- [ ] **Step 1: 重構 `adminPageHtml`**

移除整個 inline `<style>...</style>` 區塊，在 `<head>` 改用：
```html
<link rel="stylesheet" href="/assets/app.css">
```
`<body>` 內容用 `<div class="container">` 包住。HTML class 對應：
- 區塊 `<section>` → `<section class="card">`
- 標題沿用 `<h1>`/`<h2>`（CSS 已定義）
- 輸入框 `<input>`/`<select>` → 加 class `input`/`select`
- 按鈕：儲存設定 → `class="btn btn-primary"`；新增供應商 → `class="btn btn-secondary"`；刪 → `class="btn btn-danger"`
- 類別區 → `<div class="cats">`
- 連結欄的 `<code>`、`.muted` 沿用
- 供應商列的刪除按鈕 class 改為 `btn btn-danger del-row`

保留所有 `<script>` JS 邏輯不動（事件委派、fetch）。但 `supplierRowHtml` 與 `renderCats` 產生的 HTML 中，按鈕/輸入的 class 要對齊上述（例如 `del-row` 按鈕加 `btn btn-danger`，輸入加 `input`）。

- [ ] **Step 2: 確認 tsc**

```bash
cd /Users/lightman/yao.care/agent.scope3esg/scope3-worker
pnpm tsc --noEmit 2>&1 | grep "page.ts" || echo "OK"
```

- [ ] **Step 3: Commit**

```bash
cd /Users/lightman/yao.care/agent.scope3esg
git add scope3-worker/src/admin/page.ts
git commit -m "refactor: admin page uses shared app.css"
```

---

## Task 5: 重構供應商填表頁 + 成功頁

**Files:** Modify `scope3-worker/src/routes/submit.ts`

- [ ] **Step 1: 重構 `formHtml` 與 `successHtml`**

`formHtml`：移除 inline `<style>`，`<head>` 加 `<link rel="stylesheet" href="/assets/app.css">`，`<body>` 用 `<div class="container">`。class 對應：
- `<form>` 內標籤 `<label>` → `class="label"`
- `<select>`/`<input>` → 加 `select`/`input`
- 數量+單位的 `.row` 沿用 `<div class="row">`
- 供應商資訊 `<p class="supplier">` → `class="supplier-note"`
- 提交按鈕 → `class="btn btn-primary btn-lg"`

`successHtml`：移除 inline `<style>`，加 `<link>`，內容用 `<div class="container"><div class="success-box">...</div></div>`。

保留 POST handler 的 JS 連動邏輯（單位依活動類型）不動。

- [ ] **Step 2: 確認 tsc**

```bash
pnpm tsc --noEmit 2>&1 | grep "submit.ts" || echo "OK"
```

- [ ] **Step 3: Commit**

```bash
cd /Users/lightman/yao.care/agent.scope3esg
git add scope3-worker/src/routes/submit.ts
git commit -m "refactor: supplier form and success page use shared app.css"
```

---

## Task 6: 重構儀表板

**Files:** Modify `scope3-worker/tenant-template/docs/index.html`、`scope3-worker/tenant-template/docs/dashboard.js`

- [ ] **Step 1: 重構 `tenant-template/docs/index.html`**

移除 inline `<style>`，`<head>` 加 `<link rel="stylesheet" href="./app.css">`，`<body>` 主要內容用 `<div class="container">` 包。`<section>` → `<section class="card">`。KPI 卡片容器 `<div class="kpis">`。

- [ ] **Step 2: 重構 `tenant-template/docs/dashboard.js` 的 renderKpis**

`renderKpis` 產生的卡片 HTML 改用共用 class：
```javascript
function renderKpis(k) {
  var cards = [
    { label: 'Total Scope 3', value: fmt(k.totalCo2e / 1000), unit: 'tCO₂e' },
    { label: '供應商數', value: k.supplierCount, unit: '家' },
    { label: '已核定筆數', value: k.submissionCount, unit: '筆' },
    { label: '涵蓋類別數', value: Object.keys(k.byCategory).length, unit: '類' },
  ];
  document.getElementById('kpis').innerHTML = cards.map(function (c) {
    return '<div class="card"><div class="muted">' + c.label + '</div>' +
           '<div class="kpi-value">' + c.value + ' <span class="kpi-unit">' + c.unit + '</span></div></div>';
  }).join('');
}
```
`renderBars` 維持產生 `.bar-row`/`.bar-track`/`.bar-fill`（CSS 已定義），其中 `bar-fill` 的動態 `width` 仍用 inline style（必要）。

- [ ] **Step 3: 重新打包並語法檢查**

```bash
cd /Users/lightman/yao.care/agent.scope3esg/scope3-worker
pnpm run build:templates >/dev/null 2>&1
node --check tenant-template/docs/dashboard.js && echo "OK"
```

- [ ] **Step 4: Commit**

```bash
cd /Users/lightman/yao.care/agent.scope3esg
git add scope3-worker/tenant-template/docs/index.html scope3-worker/tenant-template/docs/dashboard.js scope3-worker/src/templates/generated.ts
git commit -m "refactor: dashboard uses shared app.css"
```

---

## Task 7: CLAUDE.md 註記 + 全套測試 + 部署

**Files:** Modify `CLAUDE.md`

- [ ] **Step 1: 在專案 `CLAUDE.md` 的「開發紀律」區加一行**

```markdown
- HTML 頁面 CSS 用單一來源 `src/ui/theme.mjs`（oklch design tokens）；Mermaid 圖表仍用 hex（見全域規則）。改樣式只改 theme.mjs。
```

- [ ] **Step 2: 全套測試 + tsc**

```bash
cd /Users/lightman/yao.care/agent.scope3esg/scope3-worker
pnpm test 2>&1 | grep -E "Test Files|Tests|failed"
pnpm tsc --noEmit 2>&1 | grep -E "^src/" || echo "src clean"
```

Expected: 兩 pool 全綠、src clean

- [ ] **Step 3: 補既有 repo 的 app.css（既有租戶 repo 缺新檔）**

既有 `yao-care/scope3-inventory` 是在加入 app.css 前建立的，需手動補（dashboard 才能 link 到）：
```bash
cd /Users/lightman/yao.care/agent.scope3esg/scope3-worker
CONTENT=$(openssl base64 -A -in tenant-template/docs/app.css)
gh api -X PUT /repos/yao-care/scope3-inventory/contents/docs/app.css -f message="chore: add shared app.css" -f content="$CONTENT"
# 同樣更新 docs/index.html、docs/dashboard.js（取現有 sha 後 PUT）
```

- [ ] **Step 4: Commit 並部署**

```bash
cd /Users/lightman/yao.care/agent.scope3esg
git add CLAUDE.md
git commit -m "docs: note HTML CSS uses oklch theme source"
git push
```

部署後驗證：`curl https://scope3-worker.lightman-chang.workers.dev/assets/app.css | head` 應回 CSS；瀏覽器開 admin / 填表頁確認套用新樣式。

---

## 驗收標準

- [ ] `src/ui/theme.mjs` 為唯一 CSS 來源
- [ ] `GET /assets/app.css` 回 text/css 含 oklch tokens（測試通過）
- [ ] `build-templates` 輸出 `tenant-template/docs/app.css`（內容 = APP_CSS）
- [ ] admin / 填表 / 成功頁 / 儀表板皆移除 inline `<style>`、改 link 共用 CSS
- [ ] 兩個 vitest pool 全套測試 PASS、src TypeScript 乾淨
- [ ] 改 `theme.mjs` 一處即可調整全站樣式
