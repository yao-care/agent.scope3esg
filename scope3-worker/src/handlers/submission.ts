import { getSupplierToken, insertAuditLog } from '../db/queries';
import { getInstallationOctokit } from '../github/app';
import { getMainSha, createBranch, commitFileToBranch, openPullRequest } from '../github/pr';
import type { Bindings, Submission } from '../types';

interface SubmissionInput {
  org:           string;
  supplierToken: string;
  data: {
    scope3_category: number;
    period:          string;
    activity_type:   string;
    amount:          number;
    unit:            string;
    evidence_urls:   string[];
  };
  channel: 'form' | 'api' | 'pull';
}

interface SubmissionResult {
  success:   boolean;
  prNumber?: number;
  error?:    string;
}

export async function processSubmission(
  env: Bindings,
  input: SubmissionInput,
): Promise<SubmissionResult> {
  const tokenRow = await getSupplierToken(env.DB, input.supplierToken);
  if (!tokenRow || tokenRow.org !== input.org) {
    return { success: false, error: '無效的填表連結' };
  }

  if (new Date(tokenRow.expiresAt) < new Date()) {
    return { success: false, error: '填表連結已過期' };
  }

  const tenantRow = await env.DB
    .prepare('SELECT * FROM tenants WHERE org = ? LIMIT 1')
    .bind(input.org)
    .first<{ installation_id: number; org: string }>();

  if (!tenantRow) {
    return { success: false, error: '租戶不存在' };
  }

  const octokit = await getInstallationOctokit(env, tenantRow.installation_id);

  const submission: Submission = {
    submission_id:      crypto.randomUUID(),
    supplier_id:        tokenRow.supplierId,
    supplier_name:      tokenRow.supplierId,
    scope3_category:    input.data.scope3_category,
    period:             input.data.period,
    activity_type:      input.data.activity_type,
    amount:             input.data.amount,
    unit:               input.data.unit,
    evidence_urls:      input.data.evidence_urls,
    submitted_at:       new Date().toISOString(),
    channel:            input.channel,
    emission_factor_id: null,
    calculated_co2e:    null,
  };

  // branch/PR 盤查模型：一筆提交 = 分支 + submission JSON 檔 + PR（不 push、不 dispatch，
  // 由 repo 端 on:pull_request workflow 自動跑驗證）。
  const branch = `sub/${submission.supplier_id}/${submission.submission_id}`;
  const path   = `submissions/${submission.supplier_id}/${submission.submission_id}.json`;

  const mainSha = await getMainSha(octokit, input.org);
  await createBranch(octokit, input.org, branch, mainSha);
  await commitFileToBranch(
    octokit,
    input.org,
    branch,
    path,
    JSON.stringify(submission, null, 2),
    `submission: ${submission.supplier_id} ${submission.period} ${submission.activity_type}`,
  );

  const title = `[${submission.supplier_name}] Scope 3 Cat.${submission.scope3_category} — ${submission.period}`;
  const body = [
    '## 供應商碳排資料提交（待盤查員審核）',
    '',
    '| 欄位 | 值 |',
    '|------|-----|',
    `| 供應商 | ${submission.supplier_name} (${submission.supplier_id}) |`,
    `| 類別 | Scope 3 Category ${submission.scope3_category} |`,
    `| 期間 | ${submission.period} |`,
    `| 活動類型 | ${submission.activity_type} |`,
    `| 數量 | ${submission.amount} ${submission.unit} |`,
    `| 管道 | ${submission.channel} |`,
    '',
    '審核通過請 **merge** 此 PR；需補件請留言並關閉或要求修改。',
  ].join('\n');

  const prNumber = await openPullRequest(octokit, input.org, branch, title, body);

  await insertAuditLog(env.DB, { org: input.org, action: 'submission_pr_opened', actor: submission.supplier_id, target: `PR#${prNumber}` });

  return { success: true, prNumber };
}
