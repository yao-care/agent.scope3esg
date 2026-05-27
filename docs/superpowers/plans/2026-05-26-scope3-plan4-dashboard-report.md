# Scope 3 GitHub App — Plan 4: 儀表板與報表

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在租戶 `scope3-inventory` repo 建立 GitHub Pages 儀表板（讀 `data/submissions.json` 顯示 KPI 與圖表）與報表輸出（CSV + GHG Protocol Markdown，上傳至 GitHub Releases），並透過 GitHub Actions 自動部署 Pages。

**Architecture:** 沿用 Plan 3 的 `tenant-template/` 單一事實來源機制。儀表板為純前端靜態檔（`docs/`），以 vanilla JS 抓取 `./data/submissions.json` 並用內嵌 SVG 長條圖呈現（無 CDN 依賴，CSP 友善）。彙整邏輯 `docs/aggregate.mjs` 與報表邏輯 `scripts/report-lib.mjs` 皆為純函式，由 vitest（node pool）測試。`pages.yml` 在 `submissions.json` 或 `docs/**` 變更時，把資料複製進 `docs/data/` 後用官方 `actions/deploy-pages` 部署。`report.yml` 以 `workflow_dispatch` 手動觸發，產生 CSV 與 Markdown 報告並建立 GitHub Release。所有新檔案經 `build-templates` 打包進 `generated.ts`，由既有 `createTenantRepo` 自動 commit（其測試動態比對 `TENANT_FILES`，無需改動）。

**Tech Stack:** Vanilla JS（ES modules、內嵌 SVG）、Node ESM、GitHub Actions（Pages、Releases）、Vitest

---

## 既有相關程式碼（Plan 3 完成）

```
scope3-worker/tenant-template/        # 租戶 repo 檔案單一事實來源
│   ├── config.yml
│   ├── data/emission-factors.json
│   ├── scripts/{lib,validate,calculate}.mjs
│   └── .github/workflows/{validate,calculate}.yml
scope3-worker/scripts/build-templates.mjs   # 打包 → src/templates/generated.ts
scope3-worker/src/github/repo.ts            # createTenantRepo 迴圈 commit TENANT_FILES + 22 labels
scope3-worker/tests/github/repo.test.ts     # 動態比對 committedPaths === Object.keys(TENANT_FILES)
scope3-worker/tests/tenant/lib.test.ts      # node pool
scope3-worker/package.json                  # test = test:cf && test:node；build:templates
```

`data/submissions.json` 由 `calculate.mjs` 產生，每筆形如：
```json
{ "submission_id": "...", "supplier_id": "SUP001", "scope3_category": 1, "period": "2025-Q1",
  "activity_type": "electricity", "amount": 10000, "unit": "kWh",
  "emission_factor_id": "TW_ELEC_2025", "calculated_co2e": 5090,
  "approved_at": "2025-06-01T10:00:00Z", "issue_number": 42 }
```

---

## 新增檔案結構

```
scope3-worker/
├── tenant-template/
│   ├── docs/
│   │   ├── index.html                  # NEW: 儀表板頁面
│   │   ├── dashboard.js                 # NEW: 載入資料、渲染（import aggregate.mjs）
│   │   ├── aggregate.mjs                # NEW: 純彙整函式（KPI）
│   │   └── data/.gitkeep                # NEW: 佔位，pages.yml 會放 submissions.json
│   ├── scripts/
│   │   ├── report-lib.mjs               # NEW: 純報表函式（toCsv、toGhgMarkdown）
│   │   └── report.mjs                   # NEW: report workflow 腳本
│   └── .github/workflows/
│       ├── pages.yml                    # NEW: 部署 GitHub Pages
│       └── report.yml                   # NEW: 產生報表 + Release
├── tests/tenant/
│   ├── aggregate.test.ts                # NEW: 測 aggregate.mjs
│   └── report-lib.test.ts               # NEW: 測 report-lib.mjs
└── src/templates/generated.ts           # 重新打包（自動更新）
```

---

## Task 1: 儀表板彙整邏輯 aggregate.mjs（TDD）

**Files:**
- Create: `scope3-worker/tenant-template/docs/aggregate.mjs`
- Create: `scope3-worker/tests/tenant/aggregate.test.ts`

- [ ] **Step 1: 建立失敗的測試 `tests/tenant/aggregate.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { aggregateKpis } from '../../tenant-template/docs/aggregate.mjs';

const subs = [
  { supplier_id: 'SUP001', scope3_category: 1, activity_type: 'electricity', calculated_co2e: 5090 },
  { supplier_id: 'SUP001', scope3_category: 1, activity_type: 'electricity', calculated_co2e: 1000 },
  { supplier_id: 'SUP002', scope3_category: 4, activity_type: 'transport', calculated_co2e: 3000 },
];

describe('aggregateKpis', () => {
  it('sums total co2e across all submissions', () => {
    expect(aggregateKpis(subs).totalCo2e).toBeCloseTo(9090);
  });
  it('counts distinct suppliers', () => {
    expect(aggregateKpis(subs).supplierCount).toBe(2);
  });
  it('aggregates co2e by category', () => {
    const byCat = aggregateKpis(subs).byCategory;
    expect(byCat[1]).toBeCloseTo(6090);
    expect(byCat[4]).toBeCloseTo(3000);
  });
  it('ranks top suppliers by co2e descending', () => {
    const top = aggregateKpis(subs).topSuppliers;
    expect(top[0].supplier_id).toBe('SUP001');
    expect(top[0].co2e).toBeCloseTo(6090);
    expect(top[1].supplier_id).toBe('SUP002');
  });
  it('handles empty input', () => {
    const k = aggregateKpis([]);
    expect(k.totalCo2e).toBe(0);
    expect(k.supplierCount).toBe(0);
    expect(k.topSuppliers).toEqual([]);
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

```bash
cd /Users/lightman/yao.care/agent.scope3esg/scope3-worker
pnpm vitest run --config vitest.middleware.config.ts tests/tenant/aggregate.test.ts 2>&1 | tail -12
```

Expected: FAIL — 找不到模組 aggregate.mjs

- [ ] **Step 3: 實作 `tenant-template/docs/aggregate.mjs`**

```javascript
// tenant-template/docs/aggregate.mjs
// 純彙整函式：把已核定的 submissions 彙整成儀表板 KPI。
// 同時被瀏覽器（dashboard.js）與 worker 單元測試使用，無外部相依。

export function aggregateKpis(submissions) {
  const subs = Array.isArray(submissions) ? submissions : [];
  let totalCo2e = 0;
  const byCategory = {};
  const byActivity = {};
  const bySupplier = {};

  for (const s of subs) {
    const co2e = Number(s.calculated_co2e) || 0;
    totalCo2e += co2e;
    byCategory[s.scope3_category] = (byCategory[s.scope3_category] || 0) + co2e;
    byActivity[s.activity_type] = (byActivity[s.activity_type] || 0) + co2e;
    bySupplier[s.supplier_id] = (bySupplier[s.supplier_id] || 0) + co2e;
  }

  const topSuppliers = Object.entries(bySupplier)
    .map(([supplier_id, co2e]) => ({ supplier_id, co2e }))
    .sort((a, b) => b.co2e - a.co2e)
    .slice(0, 10);

  return {
    totalCo2e,
    supplierCount: Object.keys(bySupplier).length,
    submissionCount: subs.length,
    byCategory,
    byActivity,
    topSuppliers,
  };
}
```

- [ ] **Step 4: 執行測試確認通過**

```bash
pnpm vitest run --config vitest.middleware.config.ts tests/tenant/aggregate.test.ts 2>&1 | tail -12
```

Expected: 5 tests PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/lightman/yao.care/agent.scope3esg
git add scope3-worker/tenant-template/docs/aggregate.mjs scope3-worker/tests/tenant/aggregate.test.ts
git commit -m "feat: add dashboard KPI aggregation with tests"
```

---

## Task 2: 儀表板頁面 index.html + dashboard.js

**Files:**
- Create: `scope3-worker/tenant-template/docs/index.html`
- Create: `scope3-worker/tenant-template/docs/dashboard.js`
- Create: `scope3-worker/tenant-template/docs/data/.gitkeep`

- [ ] **Step 1: 建立 `tenant-template/docs/index.html`**

```html
<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Scope 3 碳排盤點儀表板</title>
<style>
  :root { --fg:#1a1a1a; --muted:#666; --accent:#0070f3; --bar:#0070f3; --bg:#f7f8fa; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", sans-serif; margin: 0; background: var(--bg); color: var(--fg); }
  header { background: #fff; padding: 24px; border-bottom: 1px solid #e5e7eb; }
  header h1 { margin: 0; font-size: 1.4rem; }
  header p { margin: 4px 0 0; color: var(--muted); font-size: .9rem; }
  main { max-width: 960px; margin: 0 auto; padding: 24px; }
  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; }
  .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; }
  .card .label { color: var(--muted); font-size: .82rem; }
  .card .value { font-size: 1.8rem; font-weight: 700; margin-top: 6px; }
  .card .unit { font-size: .9rem; color: var(--muted); font-weight: 400; }
  section { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin-top: 24px; }
  section h2 { margin: 0 0 16px; font-size: 1.05rem; }
  .bar-row { display: flex; align-items: center; gap: 12px; margin: 8px 0; font-size: .88rem; }
  .bar-row .name { width: 160px; flex-shrink: 0; color: var(--muted); }
  .bar-track { flex: 1; background: #eef1f5; border-radius: 4px; overflow: hidden; height: 22px; }
  .bar-fill { height: 100%; background: var(--bar); }
  .bar-row .num { width: 110px; text-align: right; flex-shrink: 0; font-variant-numeric: tabular-nums; }
  .empty { color: var(--muted); text-align: center; padding: 40px; }
  footer { text-align: center; color: var(--muted); font-size: .8rem; padding: 24px; }
</style>
</head>
<body>
<header>
  <h1>Scope 3 碳排盤點儀表板</h1>
  <p id="subtitle">載入中…</p>
</header>
<main>
  <div class="kpis" id="kpis"></div>
  <section><h2>各類別排放量（kgCO₂e）</h2><div id="by-category"></div></section>
  <section><h2>排放前 10 供應商（kgCO₂e）</h2><div id="top-suppliers"></div></section>
  <section><h2>各活動類型排放量（kgCO₂e）</h2><div id="by-activity"></div></section>
</main>
<footer>資料來源：data/submissions.json ｜ 由 Scope3 GitHub App 自動產生</footer>
<script type="module" src="./dashboard.js"></script>
</body>
</html>
```

- [ ] **Step 2: 建立 `tenant-template/docs/dashboard.js`**

```javascript
// tenant-template/docs/dashboard.js
import { aggregateKpis } from './aggregate.mjs';

const CATEGORY_NAMES = {
  1: '採購商品與服務', 2: '資本財', 3: '燃料與能源', 4: '上游運輸配送',
  5: '營運廢棄物', 6: '商務旅行', 7: '員工通勤', 8: '上游租賃資產',
  9: '下游運輸配送', 10: '售出產品加工', 11: '售出產品使用', 12: '售出產品報廢',
  13: '下游租賃資產', 14: '加盟', 15: '投資',
};

function fmt(n) {
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 });
}

function renderBars(containerId, rows) {
  const el = document.getElementById(containerId);
  if (!rows.length) { el.innerHTML = '<div class="empty">尚無資料</div>'; return; }
  const max = Math.max(...rows.map((r) => r.value), 1);
  el.innerHTML = rows
    .map((r) => {
      const pct = (r.value / max) * 100;
      return `<div class="bar-row">
        <span class="name">${r.name}</span>
        <span class="bar-track"><span class="bar-fill" style="width:${pct}%"></span></span>
        <span class="num">${fmt(r.value)}</span>
      </div>`;
    })
    .join('');
}

function renderKpis(k) {
  const cards = [
    { label: 'Total Scope 3', value: fmt(k.totalCo2e / 1000), unit: 'tCO₂e' },
    { label: '供應商數', value: k.supplierCount, unit: '家' },
    { label: '已核定筆數', value: k.submissionCount, unit: '筆' },
    { label: '涵蓋類別數', value: Object.keys(k.byCategory).length, unit: '類' },
  ];
  document.getElementById('kpis').innerHTML = cards
    .map((c) => `<div class="card"><div class="label">${c.label}</div><div class="value">${c.value} <span class="unit">${c.unit}</span></div></div>`)
    .join('');
}

async function main() {
  let subs = [];
  try {
    const res = await fetch('./data/submissions.json', { cache: 'no-store' });
    if (res.ok) subs = await res.json();
  } catch {
    // 無資料檔，視為空
  }
  if (!Array.isArray(subs)) subs = [];

  const k = aggregateKpis(subs);
  document.getElementById('subtitle').textContent = `共 ${k.submissionCount} 筆已核定資料 ｜ 更新於 ${new Date().toLocaleString('zh-TW')}`;
  renderKpis(k);

  renderBars(
    'by-category',
    Object.entries(k.byCategory)
      .map(([cat, value]) => ({ name: `Cat.${cat} ${CATEGORY_NAMES[cat] || ''}`, value }))
      .sort((a, b) => b.value - a.value),
  );
  renderBars(
    'top-suppliers',
    k.topSuppliers.map((s) => ({ name: s.supplier_id, value: s.co2e })),
  );
  renderBars(
    'by-activity',
    Object.entries(k.byActivity)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value),
  );
}

main();
```

- [ ] **Step 3: 建立佔位檔 `tenant-template/docs/data/.gitkeep`**

內容：單行說明
```
此目錄由 pages.yml 在部署時放入 submissions.json 副本。
```

- [ ] **Step 4: 重新打包並確認**

```bash
cd /Users/lightman/yao.care/agent.scope3esg/scope3-worker
pnpm run build:templates 2>&1 | grep -E "docs/"
node --check tenant-template/docs/dashboard.js && node --check tenant-template/docs/aggregate.mjs && echo "syntax OK"
```

Expected: 輸出含 `docs/index.html`、`docs/dashboard.js`、`docs/aggregate.mjs`、`docs/data/.gitkeep`；`syntax OK`

- [ ] **Step 5: Commit**

```bash
cd /Users/lightman/yao.care/agent.scope3esg
git add scope3-worker/tenant-template/docs scope3-worker/src/templates/generated.ts
git commit -m "feat: add GitHub Pages dashboard for Scope 3 inventory"
```

---

## Task 3: 報表邏輯 report-lib.mjs（TDD）

**Files:**
- Create: `scope3-worker/tenant-template/scripts/report-lib.mjs`
- Create: `scope3-worker/tests/tenant/report-lib.test.ts`

- [ ] **Step 1: 建立失敗的測試 `tests/tenant/report-lib.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { toCsv, toGhgMarkdown } from '../../tenant-template/scripts/report-lib.mjs';

const subs = [
  { submission_id: 'a1', supplier_id: 'SUP001', scope3_category: 1, period: '2025-Q1', activity_type: 'electricity', amount: 10000, unit: 'kWh', emission_factor_id: 'TW_ELEC_2025', calculated_co2e: 5090, issue_number: 42 },
  { submission_id: 'b2', supplier_id: 'SUP002', scope3_category: 4, period: '2025-Q1', activity_type: 'transport', amount: 500, unit: 'km', emission_factor_id: 'GLOBAL_TRANSPORT_2025', calculated_co2e: 60, issue_number: 43 },
];

describe('toCsv', () => {
  it('produces a header row plus one row per submission', () => {
    const lines = toCsv(subs).trim().split('\n');
    expect(lines.length).toBe(3); // header + 2
    expect(lines[0]).toContain('supplier_id');
    expect(lines[0]).toContain('calculated_co2e');
  });
  it('escapes fields containing commas', () => {
    const csv = toCsv([{ ...subs[0], supplier_id: 'A,B' }]);
    expect(csv).toContain('"A,B"');
  });
  it('handles empty input with header only', () => {
    expect(toCsv([]).trim().split('\n').length).toBe(1);
  });
});

describe('toGhgMarkdown', () => {
  it('includes total tCO2e and per-category breakdown', () => {
    const md = toGhgMarkdown(subs, 2025);
    expect(md).toContain('2025');
    expect(md).toMatch(/5\.15|5\.150|5150/); // total 5150 kg = 5.15 t
    expect(md).toContain('Category 1');
    expect(md).toContain('Category 4');
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

```bash
cd /Users/lightman/yao.care/agent.scope3esg/scope3-worker
pnpm vitest run --config vitest.middleware.config.ts tests/tenant/report-lib.test.ts 2>&1 | tail -12
```

Expected: FAIL — 找不到模組

- [ ] **Step 3: 實作 `tenant-template/scripts/report-lib.mjs`**

```javascript
// tenant-template/scripts/report-lib.mjs
// 純報表產生函式：CSV 與 GHG Protocol Markdown。無外部相依。

const CSV_COLUMNS = [
  'submission_id', 'supplier_id', 'scope3_category', 'period',
  'activity_type', 'amount', 'unit', 'emission_factor_id',
  'calculated_co2e', 'issue_number',
];

function escapeCsv(value) {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function toCsv(submissions) {
  const subs = Array.isArray(submissions) ? submissions : [];
  const header = CSV_COLUMNS.join(',');
  const rows = subs.map((s) => CSV_COLUMNS.map((c) => escapeCsv(s[c])).join(','));
  return [header, ...rows].join('\n') + '\n';
}

export function toGhgMarkdown(submissions, year) {
  const subs = Array.isArray(submissions) ? submissions : [];
  let total = 0;
  const byCat = {};
  for (const s of subs) {
    const co2e = Number(s.calculated_co2e) || 0;
    total += co2e;
    byCat[s.scope3_category] = (byCat[s.scope3_category] || 0) + co2e;
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

- [ ] **Step 4: 執行測試確認通過**

```bash
pnpm vitest run --config vitest.middleware.config.ts tests/tenant/report-lib.test.ts 2>&1 | tail -12
```

Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/lightman/yao.care/agent.scope3esg
git add scope3-worker/tenant-template/scripts/report-lib.mjs scope3-worker/tests/tenant/report-lib.test.ts
git commit -m "feat: add CSV and GHG Protocol report generators with tests"
```

---

## Task 4: report.mjs 腳本 + pages.yml + report.yml workflow

**Files:**
- Create: `scope3-worker/tenant-template/scripts/report.mjs`
- Create: `scope3-worker/tenant-template/.github/workflows/pages.yml`
- Create: `scope3-worker/tenant-template/.github/workflows/report.yml`

- [ ] **Step 1: 建立 `tenant-template/scripts/report.mjs`**

```javascript
// tenant-template/scripts/report.mjs
// 由 report.yml 執行：讀 data/submissions.json → 產生 reports/ 下的 CSV 與 Markdown。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { toCsv, toGhgMarkdown } from './report-lib.mjs';

let subs = [];
try {
  subs = JSON.parse(readFileSync('data/submissions.json', 'utf8'));
  if (!Array.isArray(subs)) subs = [];
} catch {
  subs = [];
}

const year = new Date().getFullYear();
mkdirSync('reports', { recursive: true });

const stamp = new Date().toISOString().slice(0, 10);
const csvPath = `reports/scope3-${stamp}.csv`;
const mdPath = `reports/scope3-report-${stamp}.md`;

writeFileSync(csvPath, toCsv(subs));
writeFileSync(mdPath, toGhgMarkdown(subs, year));

// 供 workflow 後續步驟使用
const out = process.env.GITHUB_OUTPUT;
if (out) {
  writeFileSync(out, `csv_path=${csvPath}\nmd_path=${mdPath}\ntag=report-${stamp}\n`, { flag: 'a' });
}
console.log(`Generated ${csvPath} and ${mdPath} from ${subs.length} submission(s).`);
```

- [ ] **Step 2: 建立 `tenant-template/.github/workflows/pages.yml`**

```yaml
name: Deploy Dashboard to Pages

on:
  push:
    branches: [main]
    paths:
      - 'data/submissions.json'
      - 'docs/**'
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Copy submissions into docs/data
        run: |
          mkdir -p docs/data
          cp -f data/submissions.json docs/data/submissions.json 2>/dev/null || echo "[]" > docs/data/submissions.json
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: docs
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 3: 建立 `tenant-template/.github/workflows/report.yml`**

```yaml
name: Generate Scope 3 Report

on:
  workflow_dispatch:
  schedule:
    - cron: '0 1 1 * *'  # 每月 1 號 01:00 UTC

permissions:
  contents: write

jobs:
  report:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Generate reports
        id: gen
        run: node scripts/report.mjs
      - name: Create Release with report assets
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          gh release create "${{ steps.gen.outputs.tag }}" \
            "${{ steps.gen.outputs.csv_path }}" \
            "${{ steps.gen.outputs.md_path }}" \
            --title "Scope 3 Report ${{ steps.gen.outputs.tag }}" \
            --notes-file "${{ steps.gen.outputs.md_path }}"
```

- [ ] **Step 4: 重新打包並語法檢查**

```bash
cd /Users/lightman/yao.care/agent.scope3esg/scope3-worker
pnpm run build:templates 2>&1 | grep -E "report|pages"
node --check tenant-template/scripts/report.mjs && echo "syntax OK"
```

Expected: 輸出含 `scripts/report.mjs`、`scripts/report-lib.mjs`、`.github/workflows/pages.yml`、`.github/workflows/report.yml`；`syntax OK`

- [ ] **Step 5: Commit**

```bash
cd /Users/lightman/yao.care/agent.scope3esg
git add scope3-worker/tenant-template/scripts/report.mjs \
        scope3-worker/tenant-template/.github/workflows/pages.yml \
        scope3-worker/tenant-template/.github/workflows/report.yml \
        scope3-worker/src/templates/generated.ts
git commit -m "feat: add report generation and Pages deploy workflows"
```

---

## Task 5: 全套測試 + repo.test.ts 驗證 + push

**Files:**（僅執行驗證，無新檔；如 repo.test.ts 需調整則修改）

- [ ] **Step 1: 確認 createTenantRepo 測試仍綠（動態比對 TENANT_FILES，應自動涵蓋新檔）**

```bash
cd /Users/lightman/yao.care/agent.scope3esg/scope3-worker
pnpm vitest run --config vitest.middleware.config.ts tests/github/repo.test.ts 2>&1 | tail -10
```

Expected: 3 tests PASS（committedPaths 動態等於 Object.keys(TENANT_FILES)，新增的 docs/、report 檔自動納入）

- [ ] **Step 2: 執行兩個 pool 的全套測試**

```bash
pnpm test 2>&1 | grep -E "Test Files|Tests|FAIL|failed" | head -10
```

Expected: 兩個 pool 全部 PASS（Cloudflare pool 12 tests；Node pool 應增為 31 tests = 22 + aggregate 5 + report-lib 4）

- [ ] **Step 3: 確認 TypeScript src 乾淨**

```bash
pnpm tsc --noEmit 2>&1 | grep -E "^src/" || echo "src clean"
```

Expected: `src clean`

- [ ] **Step 4: Push 觸發部署**

```bash
cd /Users/lightman/yao.care/agent.scope3esg
git push
```

注意：Worker 部署仍會因 R2 bucket 未建立而失敗（需使用者先啟用 R2）。此為已知外部阻塞，與本 plan 程式碼無關。租戶 repo 的 Pages/report workflow 在實際安裝 App 後才會於租戶 repo 內運行。

---

## 驗收標準

- [ ] `tenant-template/docs/` 含 index.html、dashboard.js、aggregate.mjs、data/.gitkeep
- [ ] `tenant-template/scripts/` 新增 report-lib.mjs、report.mjs
- [ ] `tenant-template/.github/workflows/` 新增 pages.yml、report.yml
- [ ] aggregate.mjs（5 tests）與 report-lib.mjs（4 tests）測試全綠
- [ ] `createTenantRepo` 測試仍綠，新檔自動納入 commit 清單
- [ ] 兩個 vitest pool 全套測試 PASS
- [ ] `pnpm run build:templates` 後 generated.ts 含全部新檔
- [ ] TypeScript src 乾淨

---

## 需使用者手動完成（平台授權）

- 安裝 App 後，於租戶 `scope3-inventory` repo 設定 **Settings → Pages → Source: GitHub Actions**（首次需手動啟用 Pages，之後 pages.yml 自動部署）。
- GitHub App 權限需含 **Pages (write)** 與 **Contents (write)**（已列於 Plan 3 的授權清單）。

---

## 全部 Plan 完成後的系統樣貌

- Worker：webhook 處理、三管道資料接收（Form/API/Pull）、R2 上傳、config.yml→token+email、Queue consumer
- 租戶 repo：自動建立，含 labels、config.yml、排放係數、驗證/計算/報表/Pages workflows、儀表板
- 端到端流程：安裝 App → 設定供應商 → 供應商提交 → 驗證 → 審核核定 → 計算 → 儀表板 → 報表 Release
