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
