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

const out = process.env.GITHUB_OUTPUT;
if (out) {
  writeFileSync(out, `csv_path=${csvPath}\nmd_path=${mdPath}\ntag=report-${stamp}\n`, { flag: 'a' });
}
console.log(`Generated ${csvPath} and ${mdPath} from ${subs.length} submission(s).`);
