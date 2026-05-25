import { getSupplierToken } from '../db/queries';
import { getInstallationOctokit } from '../github/app';
import { createSubmissionIssue } from '../github/issue';
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
  success:      boolean;
  issueNumber?: number;
  error?:       string;
}

export async function processSubmission(
  env: Bindings,
  input: SubmissionInput,
): Promise<SubmissionResult> {
  const tokenRow = await getSupplierToken(env.DB, input.supplierToken);
  if (!tokenRow || tokenRow.org !== input.org) {
    return { success: false, error: 'Invalid token' };
  }

  if (new Date(tokenRow.expiresAt) < new Date()) {
    return { success: false, error: 'Token expired' };
  }

  const tenantRow = await env.DB
    .prepare('SELECT * FROM tenants WHERE org = ? LIMIT 1')
    .bind(input.org)
    .first<{ installation_id: number; org: string }>();

  if (!tenantRow) {
    return { success: false, error: 'Tenant not found' };
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

  const issueNumber = await createSubmissionIssue(octokit, input.org, submission);
  return { success: true, issueNumber };
}
