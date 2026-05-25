// tenant-template/scripts/validate.mjs
// 由 validate.yml 在 issue opened/edited 時執行。
// 解析 issue body 的 scope3-data JSON，做單位/異常值/缺件驗證，
// 留言結果並在有問題時加上 validation:error label。
import { readFileSync } from 'node:fs';
import { validateUnit, detectOutlier } from './lib.mjs';

const token = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;
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
