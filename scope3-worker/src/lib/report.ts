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
    byCat[s.scope3_category as string] = (byCat[s.scope3_category as string] || 0) + co2e;
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
