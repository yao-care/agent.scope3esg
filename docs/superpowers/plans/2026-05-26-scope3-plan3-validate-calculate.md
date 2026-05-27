# Scope 3 GitHub App — Plan 3: 驗證與計算引擎

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立租戶 `scope3-inventory` repo 的驗證與計算引擎：GitHub Actions `validate.yml`（提交時驗證單位/異常值/缺件）與 `calculate.yml`（核定後計算排放量並更新 `submissions.json`），加上版本化排放係數資料庫，並把所有模板檔案整合進 `createTenantRepo`。

**Architecture:** 租戶 repo 內所有檔案（workflows、scripts、emission-factors.json、config.yml、issue template）以真實檔案存於 worker repo 的 `tenant-template/` 目錄，作為單一事實來源（single source of truth）。`scripts/build-templates.mjs` 把 `tenant-template/**` 打包成 `src/templates/generated.ts`（`Record<path, content>` 字串表），供 Worker 在 `createTenantRepo` 時逐檔 commit。純計算/驗證演算法寫在 `tenant-template/scripts/lib.mjs`（自包含 Node ESM），由 vitest（node pool）直接 import 測試；GitHub Actions runner 也直接 import 同一檔案執行。

**Tech Stack:** Node ESM scripts、GitHub Actions、`@octokit/core`、Vitest、Cloudflare Workers

---

## 既有相關程式碼

```
scope3-worker/src/github/repo.ts   # createTenantRepo：目前 inline CONFIG_YML / ISSUE_TEMPLATE，逐檔 PUT contents + 建 22 個 labels
scope3-worker/src/handlers/installation.ts  # handleInstallation 呼叫 createTenantRepo
scope3-worker/vitest.config.ts             # Cloudflare pool（D1 測試）
scope3-worker/vitest.middleware.config.ts  # Node pool，include: tests/middleware, tests/github
scope3-worker/package.json
```

`createTenantRepo(octokit, org)` 目前：
1. `POST /orgs/{org}/repos` 建立 `scope3-inventory`（private）
2. `PUT contents` commit `config.yml`
3. `PUT contents` commit `.github/ISSUE_TEMPLATE/scope3-submission.yml`
4. 迴圈建立 22 個 labels（7 status/validation + cat:1–15）
5. 回傳 `repo.node_id`

---

## 新增/修改檔案結構

```
scope3-worker/
├── tenant-template/                         # NEW: 租戶 repo 檔案的單一事實來源
│   ├── config.yml                           # NEW（從 repo.ts 移出）
│   ├── data/
│   │   └── emission-factors.json            # NEW: 版本化排放係數
│   ├── scripts/
│   │   ├── lib.mjs                          # NEW: 純驗證/計算演算法
│   │   ├── validate.mjs                     # NEW: validate workflow 腳本
│   │   └── calculate.mjs                    # NEW: calculate workflow 腳本
│   └── .github/
│       ├── ISSUE_TEMPLATE/
│       │   └── scope3-submission.yml        # NEW（從 repo.ts 移出）
│       └── workflows/
│           ├── validate.yml                 # NEW
│           └── calculate.yml                # NEW
├── scripts/
│   └── build-templates.mjs                  # NEW: 打包 tenant-template → generated.ts
├── src/
│   ├── templates/
│   │   └── generated.ts                     # NEW（自動產生，commit 進 git）
│   └── github/
│       └── repo.ts                          # MODIFY: 改用 TENANT_FILES 迴圈 commit
├── tests/
│   ├── tenant/
│   │   └── lib.test.ts                      # NEW: 測試 lib.mjs 純函式（node pool）
│   └── github/
│       └── repo.test.ts                     # NEW: 測試 createTenantRepo（node pool, mock octokit）
├── package.json                             # MODIFY: 加 build:templates script
└── vitest.middleware.config.ts              # MODIFY: include tests/tenant/**
```

---

## Task 1: tenant-template 骨架 + build-templates 打包機制

**Files:**
- Create: `scope3-worker/tenant-template/config.yml`
- Create: `scope3-worker/tenant-template/.github/ISSUE_TEMPLATE/scope3-submission.yml`
- Create: `scope3-worker/tenant-template/data/emission-factors.json`
- Create: `scope3-worker/scripts/build-templates.mjs`
- Modify: `scope3-worker/package.json`

- [ ] **Step 1: 建立 `tenant-template/config.yml`**

內容（從 repo.ts 的 CONFIG_YML 移出，年份改為靜態 2026，Worker 不需要動態替換此檔）：

```yaml
inventory_year: 2026
enabled_categories: [1, 4, 6, 7, 11]

suppliers: []
  # - id: SUP001
  #   name: 供應商名稱
  #   contact: esg@supplier.com
  #   pull_api: null
  #   pull_schedule: null
```

- [ ] **Step 2: 建立 `tenant-template/.github/ISSUE_TEMPLATE/scope3-submission.yml`**

```yaml
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

- [ ] **Step 3: 建立 `tenant-template/data/emission-factors.json`**

```json
{
  "version": "v1.0.0",
  "updated_at": "2026-05-26",
  "factors": [
    { "factor_id": "TW_ELEC_2025", "source": "Taiwan EPA", "year": 2025, "activity_type": "electricity", "value": 0.509, "unit": "kgCO2e/kWh", "region": "TW" },
    { "factor_id": "TW_NATGAS_2025", "source": "IPCC 2006", "year": 2025, "activity_type": "natural_gas", "value": 1.879, "unit": "kgCO2e/Nm3", "region": "TW" },
    { "factor_id": "TW_DIESEL_2025", "source": "IPCC 2006", "year": 2025, "activity_type": "diesel", "value": 2.606, "unit": "kgCO2e/L", "region": "TW" },
    { "factor_id": "TW_WATER_2025", "source": "Taiwan Water Corp", "year": 2025, "activity_type": "water", "value": 0.194, "unit": "kgCO2e/m3", "region": "TW" },
    { "factor_id": "TW_WASTE_2025", "source": "DEFRA 2024", "year": 2025, "activity_type": "waste", "value": 0.021, "unit": "kgCO2e/kg", "region": "TW" },
    { "factor_id": "GLOBAL_TRANSPORT_2025", "source": "GLEC", "year": 2025, "activity_type": "transport", "value": 0.12, "unit": "kgCO2e/km", "region": "GLOBAL" },
    { "factor_id": "GLOBAL_PRODUCT_2025", "source": "ecoinvent", "year": 2025, "activity_type": "product", "value": 2.0, "unit": "kgCO2e/kg", "region": "GLOBAL" }
  ]
}
```

- [ ] **Step 4: 建立 `scripts/build-templates.mjs`**

```javascript
// scripts/build-templates.mjs
// 將 tenant-template/** 打包成 src/templates/generated.ts（Record<path, content>）。
import { readdirSync, readFileSync, writeFileSync, statSync, mkdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = 'tenant-template';
const files = {};

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full);
    } else {
      const rel = relative(ROOT, full).split(sep).join('/');
      files[rel] = readFileSync(full, 'utf8');
    }
  }
}

walk(ROOT);

const sorted = Object.fromEntries(Object.keys(files).sort().map((k) => [k, files[k]]));

const out = `// AUTO-GENERATED by scripts/build-templates.mjs — DO NOT EDIT.
// Run \`pnpm run build:templates\` after changing anything under tenant-template/.
export const TENANT_FILES: Record<string, string> = ${JSON.stringify(sorted, null, 2)};
`;

mkdirSync('src/templates', { recursive: true });
writeFileSync('src/templates/generated.ts', out);
console.log(`Generated src/templates/generated.ts with ${Object.keys(sorted).length} files:`);
for (const k of Object.keys(sorted)) console.log(`  - ${k}`);
```

- [ ] **Step 5: 在 `package.json` 加入 `build:templates` script**

讀取現有 `scripts` 區塊，加入：

```json
"build:templates": "node scripts/build-templates.mjs"
```

- [ ] **Step 6: 執行打包，產生 generated.ts**

```bash
cd /Users/lightman/yao.care/agent.scope3esg/scope3-worker
pnpm run build:templates
```

Expected: 輸出列出 4 個檔案（config.yml、emission-factors.json、issue template、後續 task 再加 scripts/workflows）。確認 `src/templates/generated.ts` 已產生。

- [ ] **Step 7: Commit**

```bash
cd /Users/lightman/yao.care/agent.scope3esg
git add scope3-worker/tenant-template scope3-worker/scripts/build-templates.mjs scope3-worker/package.json scope3-worker/src/templates/generated.ts
git commit -m "feat: add tenant-template scaffold and build-templates packer"
```

---

## Task 2: 純驗證/計算演算法 lib.mjs（TDD）

**Files:**
- Create: `scope3-worker/tenant-template/scripts/lib.mjs`
- Create: `scope3-worker/tests/tenant/lib.test.ts`
- Modify: `scope3-worker/vitest.middleware.config.ts`

- [ ] **Step 1: 更新 `vitest.middleware.config.ts` 加入 tests/tenant**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/middleware/**/*.test.ts', 'tests/github/**/*.test.ts', 'tests/tenant/**/*.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 2: 建立失敗的測試 `tests/tenant/lib.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { validateUnit, convertUnit, matchFactor, calculateCo2e, detectOutlier } from '../../tenant-template/scripts/lib.mjs';

const factors = [
  { factor_id: 'TW_ELEC_2025', year: 2025, activity_type: 'electricity', value: 0.509, unit: 'kgCO2e/kWh', region: 'TW' },
  { factor_id: 'TW_ELEC_2024', year: 2024, activity_type: 'electricity', value: 0.495, unit: 'kgCO2e/kWh', region: 'TW' },
  { factor_id: 'TW_WASTE_2025', year: 2025, activity_type: 'waste', value: 0.021, unit: 'kgCO2e/kg', region: 'TW' },
];

describe('validateUnit', () => {
  it('accepts a legal unit', () => {
    expect(validateUnit('electricity', 'kWh').ok).toBe(true);
  });
  it('rejects an illegal unit', () => {
    const r = validateUnit('natural_gas', 'kg');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/kg/);
  });
  it('rejects an unknown activity type', () => {
    expect(validateUnit('unicorn', 'kWh').ok).toBe(false);
  });
});

describe('convertUnit', () => {
  it('returns same amount for identical units', () => {
    expect(convertUnit(5, 'kg', 'kg')).toBe(5);
  });
  it('converts ton to kg', () => {
    expect(convertUnit(2, 'ton', 'kg')).toBe(2000);
  });
  it('returns null for incompatible units', () => {
    expect(convertUnit(1, 'kWh', 'kg')).toBeNull();
  });
});

describe('matchFactor', () => {
  it('returns exact region+year match', () => {
    expect(matchFactor(factors, 'electricity', 'TW', 2025)?.factor_id).toBe('TW_ELEC_2025');
  });
  it('falls back to latest same-region when year missing', () => {
    expect(matchFactor(factors, 'electricity', 'TW', 2023)?.factor_id).toBe('TW_ELEC_2025');
  });
  it('returns null when activity type not found', () => {
    expect(matchFactor(factors, 'transport', 'TW', 2025)).toBeNull();
  });
});

describe('calculateCo2e', () => {
  it('multiplies amount by factor value for matching denominator unit', () => {
    const f = factors[0]; // 0.509 kgCO2e/kWh
    expect(calculateCo2e(10000, 'kWh', f)).toBeCloseTo(5090);
  });
  it('converts ton to kg before multiplying', () => {
    const f = factors[2]; // 0.021 kgCO2e/kg
    expect(calculateCo2e(2, 'ton', f)).toBeCloseTo(42); // 2000kg * 0.021
  });
  it('returns null when units cannot convert', () => {
    const f = factors[0]; // /kWh
    expect(calculateCo2e(5, 'kg', f)).toBeNull();
  });
});

describe('detectOutlier', () => {
  it('flags values over 10x historical average', () => {
    const r = detectOutlier(20000, [1000, 1500, 2000]);
    expect(r.outlier).toBe(true);
  });
  it('does not flag normal values', () => {
    expect(detectOutlier(1800, [1000, 1500, 2000]).outlier).toBe(false);
  });
  it('does not flag when no history', () => {
    expect(detectOutlier(99999, []).outlier).toBe(false);
  });
});
```

- [ ] **Step 3: 執行測試確認失敗**

```bash
cd /Users/lightman/yao.care/agent.scope3esg/scope3-worker
pnpm vitest run --config vitest.middleware.config.ts tests/tenant/lib.test.ts 2>&1 | tail -15
```

Expected: FAIL — 找不到模組 `lib.mjs`

- [ ] **Step 4: 實作 `tenant-template/scripts/lib.mjs`**

```javascript
// tenant-template/scripts/lib.mjs
// 純驗證/計算演算法。同時被 GitHub Actions runner 與 worker 單元測試使用。
// 無外部相依，僅用 Node 內建能力。

export const UNIT_RULES = {
  electricity: ['kWh'],
  natural_gas: ['Nm3'],
  diesel:      ['L'],
  water:       ['ton', 'm3'],
  waste:       ['ton', 'kg'],
  product:     ['pcs', 'kg', 'ton'],
  transport:   ['km'],
};

export function validateUnit(activityType, unit) {
  const allowed = UNIT_RULES[activityType];
  if (!allowed) return { ok: false, message: `未知活動類型：${activityType}` };
  if (!allowed.includes(unit)) {
    return { ok: false, message: `活動類型 ${activityType} 不允許單位 ${unit}（合法單位：${allowed.join(', ')}）` };
  }
  return { ok: true };
}

const MASS_TO_KG = { kg: 1, ton: 1000 };

export function convertUnit(amount, fromUnit, toUnit) {
  if (fromUnit === toUnit) return amount;
  if (fromUnit in MASS_TO_KG && toUnit in MASS_TO_KG) {
    return (amount * MASS_TO_KG[fromUnit]) / MASS_TO_KG[toUnit];
  }
  return null;
}

export function matchFactor(factors, activityType, region, year) {
  const candidates = factors.filter((f) => f.activity_type === activityType);
  if (candidates.length === 0) return null;
  const exact = candidates.find((f) => f.region === region && f.year === year);
  if (exact) return exact;
  const sameRegion = candidates.filter((f) => f.region === region).sort((a, b) => b.year - a.year);
  if (sameRegion.length) return sameRegion[0];
  return candidates.slice().sort((a, b) => b.year - a.year)[0];
}

export function calculateCo2e(amount, unit, factor) {
  const denom = factor.unit.split('/')[1];
  let qty = amount;
  if (denom !== unit) {
    const converted = convertUnit(amount, unit, denom);
    if (converted === null) return null;
    qty = converted;
  }
  return qty * factor.value;
}

export function detectOutlier(current, history) {
  if (!history || history.length === 0) return { outlier: false };
  const avg = history.reduce((a, b) => a + b, 0) / history.length;
  if (avg > 0 && current > avg * 10) {
    return { outlier: true, message: `數值 ${current} 超過歷史平均 ${avg.toFixed(1)} 的 10 倍，請確認` };
  }
  return { outlier: false };
}
```

- [ ] **Step 5: 執行測試確認通過**

```bash
pnpm vitest run --config vitest.middleware.config.ts tests/tenant/lib.test.ts 2>&1 | tail -15
```

Expected: 15 tests PASS

- [ ] **Step 6: 重新打包並 commit**

```bash
cd /Users/lightman/yao.care/agent.scope3esg/scope3-worker
pnpm run build:templates
cd /Users/lightman/yao.care/agent.scope3esg
git add scope3-worker/tenant-template/scripts/lib.mjs scope3-worker/tests/tenant/lib.test.ts scope3-worker/vitest.middleware.config.ts scope3-worker/src/templates/generated.ts
git commit -m "feat: add validation/calculation algorithms (lib.mjs) with tests"
```

---

## Task 3: validate 腳本 + workflow

**Files:**
- Create: `scope3-worker/tenant-template/scripts/validate.mjs`
- Create: `scope3-worker/tenant-template/.github/workflows/validate.yml`

- [ ] **Step 1: 建立 `tenant-template/scripts/validate.mjs`**

```javascript
// tenant-template/scripts/validate.mjs
// 由 validate.yml 在 issue opened/edited 時執行。
// 解析 issue body 的 scope3-data JSON，做單位/異常值/缺件驗證，
// 留言結果並在有問題時加上 validation:error label。
import { readFileSync } from 'node:fs';
import { validateUnit, detectOutlier } from './lib.mjs';

const token = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY; // owner/repo
const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
const issue = event.issue;

const api = (path, init = {}) =>
  fetch(`https://api.github.com/repos/${repo}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.headers || {}),
    },
  });

const match = issue.body && issue.body.match(/<!-- scope3-data:\n([\s\S]*?)\n-->/);
if (!match) {
  console.log('No scope3-data block found; skipping validation.');
  process.exit(0);
}

let data;
try {
  data = JSON.parse(match[1]);
} catch (err) {
  await api(`/issues/${issue.number}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body: '## ⚠️ 驗證錯誤\n- 無法解析提交資料 JSON' }),
  });
  await api(`/issues/${issue.number}/labels`, {
    method: 'POST',
    body: JSON.stringify({ labels: ['validation:error'] }),
  });
  process.exit(0);
}

const problems = [];

const unitCheck = validateUnit(data.activity_type, data.unit);
if (!unitCheck.ok) problems.push(unitCheck.message);

let history = [];
try {
  const subs = JSON.parse(readFileSync('data/submissions.json', 'utf8'));
  history = subs
    .filter((s) => s.supplier_id === data.supplier_id && s.activity_type === data.activity_type)
    .map((s) => s.amount);
} catch {
  // submissions.json 尚未存在，視為無歷史
}
const outlier = detectOutlier(data.amount, history);
if (outlier.outlier) problems.push(outlier.message);

if (!data.evidence_urls || data.evidence_urls.length === 0) {
  problems.push('缺少佐證文件，請補上電費單/發票等證明');
}

if (problems.length > 0) {
  await api(`/issues/${issue.number}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body: `## ⚠️ 驗證發現問題\n${problems.map((p) => `- ${p}`).join('\n')}` }),
  });
  await api(`/issues/${issue.number}/labels`, {
    method: 'POST',
    body: JSON.stringify({ labels: ['validation:error'] }),
  });
  console.log(`Validation failed with ${problems.length} problem(s).`);
} else {
  await api(`/issues/${issue.number}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body: '## ✅ 驗證通過\n單位合法、無異常值、佐證文件齊全。' }),
  });
  console.log('Validation passed.');
}
```

- [ ] **Step 2: 建立 `tenant-template/.github/workflows/validate.yml`**

```yaml
name: Validate Submission

on:
  issues:
    types: [opened, edited]

permissions:
  issues: write
  contents: read

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Run validation
        run: node scripts/validate.mjs
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 3: 重新打包並確認檔案進入 generated.ts**

```bash
cd /Users/lightman/yao.care/agent.scope3esg/scope3-worker
pnpm run build:templates 2>&1 | grep -E "validate"
```

Expected: 輸出含 `scripts/validate.mjs` 與 `.github/workflows/validate.yml`

- [ ] **Step 4: Commit**

```bash
cd /Users/lightman/yao.care/agent.scope3esg
git add scope3-worker/tenant-template/scripts/validate.mjs scope3-worker/tenant-template/.github/workflows/validate.yml scope3-worker/src/templates/generated.ts
git commit -m "feat: add submission validation workflow"
```

---

## Task 4: calculate 腳本 + workflow

**Files:**
- Create: `scope3-worker/tenant-template/scripts/calculate.mjs`
- Create: `scope3-worker/tenant-template/.github/workflows/calculate.yml`

- [ ] **Step 1: 建立 `tenant-template/scripts/calculate.mjs`**

```javascript
// tenant-template/scripts/calculate.mjs
// 由 calculate.yml 在 issue 加上 status:approved label 時執行。
// 讀 issue scope3-data → 匹配排放係數 → 計算 co2e → 更新 data/submissions.json → 留言。
import { readFileSync, writeFileSync } from 'node:fs';
import { matchFactor, calculateCo2e } from './lib.mjs';

const token = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;
const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
const issue = event.issue;

const comment = (body) =>
  fetch(`https://api.github.com/repos/${repo}/issues/${issue.number}/comments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ body }),
  });

const match = issue.body && issue.body.match(/<!-- scope3-data:\n([\s\S]*?)\n-->/);
if (!match) {
  console.log('No scope3-data block; skipping.');
  process.exit(0);
}
const data = JSON.parse(match[1]);

const efDoc = JSON.parse(readFileSync('data/emission-factors.json', 'utf8'));
const year = parseInt(String(data.period).slice(0, 4), 10);
const region = 'TW';
const factor = matchFactor(efDoc.factors, data.activity_type, region, year);

if (!factor) {
  await comment(`## ❌ 計算失敗\n找不到 \`${data.activity_type}\` 在 ${region}/${year} 的排放係數，請至 data/emission-factors.json 補上。`);
  process.exit(0);
}

const co2e = calculateCo2e(data.amount, data.unit, factor);
if (co2e === null) {
  await comment(`## ❌ 計算失敗\n單位 \`${data.unit}\` 無法轉換為係數單位 \`${factor.unit}\`，請改用相容單位或調整係數。`);
  process.exit(0);
}

let subs = [];
try {
  subs = JSON.parse(readFileSync('data/submissions.json', 'utf8'));
  if (!Array.isArray(subs)) subs = [];
} catch {
  subs = [];
}
subs = subs.filter((s) => s.submission_id !== data.submission_id);
subs.push({
  submission_id: data.submission_id,
  supplier_id: data.supplier_id,
  scope3_category: data.scope3_category,
  period: data.period,
  activity_type: data.activity_type,
  amount: data.amount,
  unit: data.unit,
  emission_factor_id: factor.factor_id,
  calculated_co2e: co2e,
  approved_at: new Date().toISOString(),
  issue_number: issue.number,
});
writeFileSync('data/submissions.json', JSON.stringify(subs, null, 2) + '\n');

await comment(
  `## ✅ 排放量計算完成\n` +
    `- 係數：\`${factor.factor_id}\`（${factor.value} ${factor.unit}，來源 ${factor.source}）\n` +
    `- 活動數據：${data.amount} ${data.unit}\n` +
    `- **計算結果：${co2e.toFixed(2)} kgCO2e（${(co2e / 1000).toFixed(3)} tCO2e）**\n` +
    `\n已寫入 \`data/submissions.json\`。`,
);
console.log(`Calculated ${co2e} kgCO2e for issue #${issue.number}.`);
```

- [ ] **Step 2: 建立 `tenant-template/.github/workflows/calculate.yml`**

```yaml
name: Calculate Emissions

on:
  issues:
    types: [labeled]

permissions:
  issues: write
  contents: write

jobs:
  calculate:
    if: github.event.label.name == 'status:approved'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Calculate emissions
        run: node scripts/calculate.mjs
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - name: Commit submissions.json
        run: |
          git config user.name "scope3-bot"
          git config user.email "bot@scope3.yao.care"
          git add data/submissions.json
          git diff --staged --quiet || git commit -m "calc: update submissions for issue #${{ github.event.issue.number }}"
          git push
```

- [ ] **Step 3: 重新打包**

```bash
cd /Users/lightman/yao.care/agent.scope3esg/scope3-worker
pnpm run build:templates 2>&1 | grep -E "calculate"
```

Expected: 輸出含 `scripts/calculate.mjs` 與 `.github/workflows/calculate.yml`

- [ ] **Step 4: Commit**

```bash
cd /Users/lightman/yao.care/agent.scope3esg
git add scope3-worker/tenant-template/scripts/calculate.mjs scope3-worker/tenant-template/.github/workflows/calculate.yml scope3-worker/src/templates/generated.ts
git commit -m "feat: add emission calculation workflow"
```

---

## Task 5: 整合進 createTenantRepo（TDD）

**Files:**
- Modify: `scope3-worker/src/github/repo.ts`
- Create: `scope3-worker/tests/github/repo.test.ts`

- [ ] **Step 1: 建立失敗的測試 `tests/github/repo.test.ts`**（node pool，mock octokit）

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTenantRepo } from '../../src/github/repo';
import { TENANT_FILES } from '../../src/templates/generated';

function makeOctokit() {
  return {
    request: vi.fn(async (route: string) => {
      if (route === 'POST /orgs/{org}/repos') return { data: { node_id: 'R_test123' } };
      return { data: {} };
    }),
  };
}

describe('createTenantRepo', () => {
  let octokit: ReturnType<typeof makeOctokit>;
  beforeEach(() => {
    octokit = makeOctokit();
  });

  it('creates the repo and returns its node_id', async () => {
    const nodeId = await createTenantRepo(octokit as any, 'acme-corp');
    expect(nodeId).toBe('R_test123');
    expect(octokit.request).toHaveBeenCalledWith(
      'POST /orgs/{org}/repos',
      expect.objectContaining({ org: 'acme-corp', name: 'scope3-inventory' }),
    );
  });

  it('commits every tenant-template file via PUT contents', async () => {
    await createTenantRepo(octokit as any, 'acme-corp');
    const putCalls = octokit.request.mock.calls.filter(
      (c) => c[0] === 'PUT /repos/{owner}/{repo}/contents/{path}',
    );
    const committedPaths = putCalls.map((c) => c[1].path).sort();
    expect(committedPaths).toEqual(Object.keys(TENANT_FILES).sort());
    // workflow 與計算腳本必須在內
    expect(committedPaths).toContain('.github/workflows/validate.yml');
    expect(committedPaths).toContain('.github/workflows/calculate.yml');
    expect(committedPaths).toContain('scripts/lib.mjs');
    expect(committedPaths).toContain('data/emission-factors.json');
  });

  it('creates all 22 labels', async () => {
    await createTenantRepo(octokit as any, 'acme-corp');
    const labelCalls = octokit.request.mock.calls.filter(
      (c) => c[0] === 'POST /repos/{owner}/{repo}/labels',
    );
    expect(labelCalls.length).toBe(22);
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

```bash
cd /Users/lightman/yao.care/agent.scope3esg/scope3-worker
pnpm vitest run --config vitest.middleware.config.ts tests/github/repo.test.ts 2>&1 | tail -15
```

Expected: FAIL — committedPaths 只含 config.yml 與 issue template（舊版 repo.ts 還沒改）

- [ ] **Step 3: 改寫 `src/github/repo.ts`**

完整替換為（保留 LABELS，移除 inline CONFIG_YML/ISSUE_TEMPLATE，改用 TENANT_FILES）：

```typescript
import type { Octokit } from '@octokit/core';
import { TENANT_FILES } from '../templates/generated';

const LABELS = [
  { name: 'status:submitted',   color: '0075ca', description: '已提交，等待審核' },
  { name: 'status:reviewing',   color: 'e4e669', description: '審核中' },
  { name: 'status:revision',    color: 'd93f0b', description: '需補件' },
  { name: 'status:approved',    color: '0e8a16', description: '已核定' },
  { name: 'status:archived',    color: 'cfd3d7', description: '已歸檔' },
  { name: 'validation:warning', color: 'fbca04', description: '驗證警告' },
  { name: 'validation:error',   color: 'b60205', description: '驗證錯誤' },
  ...Array.from({ length: 15 }, (_, i) => ({
    name:        `cat:${i + 1}`,
    color:       '1d76db',
    description: `Scope 3 Category ${i + 1}`,
  })),
];

function toBase64(text: string): string {
  return btoa(unescape(encodeURIComponent(text)));
}

export async function createTenantRepo(octokit: Octokit, org: string): Promise<string> {
  const { data: repo } = await octokit.request('POST /orgs/{org}/repos', {
    org,
    name:        'scope3-inventory',
    description: 'Scope 3 碳排資料盤點系統（由 Scope3 GitHub App 管理）',
    private:     true,
    auto_init:   false,
  });

  for (const [path, content] of Object.entries(TENANT_FILES)) {
    await octokit.request('PUT /repos/{owner}/{repo}/contents/{path}', {
      owner:   org,
      repo:    'scope3-inventory',
      path,
      message: `chore: add ${path}`,
      content: toBase64(content),
    });
  }

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

- [ ] **Step 4: 執行測試確認通過**

```bash
pnpm vitest run --config vitest.middleware.config.ts tests/github/repo.test.ts 2>&1 | tail -15
```

Expected: 3 tests PASS

- [ ] **Step 5: 確認 TypeScript 與全套測試**

```bash
pnpm tsc --noEmit 2>&1 | grep -E "repo\.ts|generated\.ts" || echo "OK"
pnpm vitest run --config vitest.middleware.config.ts 2>&1 | tail -8
```

Expected: `OK`，Node pool 全部 PASS

- [ ] **Step 6: Commit**

```bash
cd /Users/lightman/yao.care/agent.scope3esg
git add scope3-worker/src/github/repo.ts scope3-worker/tests/github/repo.test.ts
git commit -m "feat: commit full tenant-template into new tenant repos"
```

---

## Task 6: deploy 打包步驟 + 全套測試 + push

**Files:**
- Modify: `.github/workflows/deploy.yml`

- [ ] **Step 1: 讀取 `.github/workflows/deploy.yml`，在 deploy（wrangler）之前加入 build:templates 步驟**

在「執行測試」與「wrangler deploy」之間（或測試之前）加入一個 step，確保 CI 永遠用最新模板：

```yaml
      - name: Build tenant templates
        run: pnpm run build:templates
        working-directory: scope3-worker
```

注意：`working-directory` 需符合既有 step 的設定（若既有 step 已在 `scope3-worker` 下執行，沿用相同寫法）。先讀取檔案確認既有 step 的 working-directory 慣例再決定。

- [ ] **Step 2: 執行兩個 pool 的全套測試確認綠燈**

```bash
cd /Users/lightman/yao.care/agent.scope3esg/scope3-worker
pnpm vitest run 2>&1 | tail -8
pnpm vitest run --config vitest.middleware.config.ts 2>&1 | tail -8
```

Expected: 兩者全部 PASS

- [ ] **Step 3: Commit 並 push**

```bash
cd /Users/lightman/yao.care/agent.scope3esg
git add .github/workflows/deploy.yml
git commit -m "ci: build tenant templates before deploy"
git push
```

注意：部署可能因 R2 bucket 尚未建立而失敗（需使用者先在 Cloudflare Dashboard 啟用 R2）。此為已知阻塞，與 Plan 3 程式碼無關。

---

## 驗收標準

- [ ] `tenant-template/` 含 config.yml、issue template、emission-factors.json、lib.mjs、validate.mjs、calculate.mjs、validate.yml、calculate.yml
- [ ] `pnpm run build:templates` 產生 `src/templates/generated.ts` 含全部檔案
- [ ] lib.mjs 純函式測試全綠（15 tests）
- [ ] `createTenantRepo` 測試確認所有模板檔案被 commit + 22 labels（node pool）
- [ ] 兩個 vitest pool 全套測試 PASS
- [ ] TypeScript 無 repo.ts / generated.ts 錯誤

---

## 需使用者手動完成（平台授權，無法以 API 代做）

- GitHub App 權限需含 **Contents (RW)**、**Actions (RW)**、**Workflows (write)** 才能 commit `.github/workflows/*`；安裝時 GitHub 會要求重新授權。
- GitHub App 需訂閱事件：`issues`、`label`（除既有 `installation`、`push`）。

---

## 接下來（Plan 4）

- GitHub Pages 儀表板（讀 submissions.json 顯示 KPI/圖表）
- `report.yml` + Excel/CSV 報表輸出至 GitHub Releases
- Worker 在建立 repo 後啟用 GitHub Pages
