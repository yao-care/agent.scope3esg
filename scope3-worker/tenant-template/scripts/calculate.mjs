// tenant-template/scripts/calculate.mjs
// 由 calculate.yml 在 push main（submissions/** 變更）觸發。掃所有 submissions/**.json，
// 算 co2e，重建 data/submissions.json 彙整。commit 只動 data/submissions.json（不在 submissions/** path），不會重觸發。
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { matchFactor, calculateCo2e } from './lib.mjs';

const efDoc = JSON.parse(readFileSync('data/emission-factors.json', 'utf8'));

function walkJson(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walkJson(full));
    else if (entry.endsWith('.json')) out.push(full);
  }
  return out;
}

const files = walkJson('submissions');
const result = [];
for (const f of files) {
  let d;
  try { d = JSON.parse(readFileSync(f, 'utf8')); } catch { continue; }
  const year = parseInt(String(d.period).slice(0, 4), 10);
  const factor = matchFactor(efDoc.factors, d.activity_type, 'TW', year);
  const co2e = factor ? calculateCo2e(d.amount, d.unit, factor) : null;
  result.push({
    submission_id: d.submission_id,
    supplier_id: d.supplier_id,
    scope3_category: d.scope3_category,
    period: d.period,
    activity_type: d.activity_type,
    amount: d.amount,
    unit: d.unit,
    emission_factor_id: factor ? factor.factor_id : null,
    calculated_co2e: co2e,
    source_file: f,
  });
}
result.sort((a, b) => (a.supplier_id + a.period).localeCompare(b.supplier_id + b.period));
writeFileSync('data/submissions.json', JSON.stringify(result, null, 2) + '\n');
console.log(`Calculated ${result.length} submission(s) into data/submissions.json.`);
