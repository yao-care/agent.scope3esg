import type { Octokit } from '@octokit/core';
import type { Submission } from '../types';

export async function createSubmissionIssue(
  octokit: Octokit,
  org: string,
  submission: Submission,
): Promise<number> {
  const title = `[${submission.supplier_name}] Scope 3 Cat.${submission.scope3_category} — ${submission.period}`;

  const body = `## 供應商碳排資料提交

| 欄位 | 值 |
|------|-----|
| 供應商 | ${submission.supplier_name} |
| 類別 | Scope 3 Category ${submission.scope3_category} |
| 期間 | ${submission.period} |
| 活動類型 | ${submission.activity_type} |
| 數量 | ${submission.amount} ${submission.unit} |
| 管道 | ${submission.channel} |
| 提交時間 | ${submission.submitted_at} |

${submission.evidence_urls.length > 0
  ? '## 佐證文件\n' + submission.evidence_urls.map(u => `- ${u}`).join('\n')
  : ''}

<!-- scope3-data:
${JSON.stringify(submission, null, 2)}
-->`;

  const { data } = await octokit.request('POST /repos/{owner}/{repo}/issues', {
    owner:  org,
    repo:   'scope3-inventory',
    title,
    body,
    labels: ['status:submitted', `cat:${submission.scope3_category}`],
  });

  return data.number;
}
