import { processSubmission } from './submission';
import type { Bindings, PullJobMessage } from '../types';

export async function executePullJob(
  env: Bindings,
  job: PullJobMessage,
): Promise<void> {
  let response: Response;
  // 呼叫供應商 API 用供應商自己的 API 憑證（job.api_token）；若未設定則 fallback 用我們的 supplier token。
  const apiAuth = job.api_token || job.token;
  try {
    response = await fetch(job.api_url, {
      headers: { Authorization: `Bearer ${apiAuth}` },
    });
  } catch (err) {
    console.error(`[pull-job] fetch failed for ${job.org}/${job.supplier_id}:`, err);
    return;
  }

  if (!response.ok) {
    console.error(`[pull-job] API returned ${response.status} for ${job.org}/${job.supplier_id}`);
    return;
  }

  const data = await response.json<{
    scope3_category: number;
    period:          string;
    activity_type:   string;
    amount:          number;
    unit:            string;
  }>();

  await processSubmission(env, {
    org:           job.org,
    supplierToken: job.token,
    data: { ...data, evidence_urls: [] },
    channel:       'pull',
  });
}
