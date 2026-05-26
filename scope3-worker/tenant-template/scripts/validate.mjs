// tenant-template/scripts/validate.mjs
// 由 validate.yml 在 PR（pull_request）觸發。驗證 PR 變更的 submissions/*.json，於 PR 留言；有問題則退出碼 1（PR check 失敗）。
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { validateUnit, detectOutlier } from './lib.mjs';

const token = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;
const prNumber = process.env.PR_NUMBER;
const baseSha = process.env.BASE_SHA;
const headSha = process.env.HEAD_SHA;

const comment = (body) =>
  fetch(`https://api.github.com/repos/${repo}/issues/${prNumber}/comments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    body: JSON.stringify({ body }),
  });

// 取 PR 變更的 submissions json
let changed = [];
try {
  changed = execSync(`git diff --name-only ${baseSha} ${headSha}`, { encoding: 'utf8' })
    .split('\n')
    .filter((f) => f.startsWith('submissions/') && f.endsWith('.json'));
} catch (e) {
  console.error('git diff failed:', e.message);
}
if (changed.length === 0) {
  console.log('No changed submissions; skipping.');
  process.exit(0);
}

// 歷史（已彙整的）供異常值比較
let history = [];
try {
  const agg = JSON.parse(readFileSync('data/submissions.json', 'utf8'));
  if (Array.isArray(agg)) history = agg;
} catch { /* 尚無彙整 */ }

const problems = [];
for (const file of changed) {
  let data;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    problems.push(`\`${file}\`：無法解析 JSON`);
    continue;
  }
  const u = validateUnit(data.activity_type, data.unit);
  if (!u.ok) problems.push(`\`${file}\`：${u.message}`);
  const hist = history.filter((s) => s.supplier_id === data.supplier_id && s.activity_type === data.activity_type).map((s) => s.amount);
  const outlier = detectOutlier(data.amount, hist);
  if (outlier.outlier) problems.push(`\`${file}\`：${outlier.message}`);
  if (!data.evidence_urls || data.evidence_urls.length === 0) problems.push(`\`${file}\`：缺少佐證文件`);
}

if (problems.length > 0) {
  await comment(`## ⚠️ 驗證發現問題\n${problems.map((p) => `- ${p}`).join('\n')}\n\n請修正後更新，或由盤查員判斷。`);
  console.log(`Validation found ${problems.length} problem(s).`);
  process.exit(1);
} else {
  await comment('## ✅ 驗證通過\n單位合法、無異常值、佐證文件齊全。可進行審核。');
  console.log('Validation passed.');
}
