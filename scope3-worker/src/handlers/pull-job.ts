import { processSubmission } from './submission';
import type { Bindings, PullJobMessage } from '../types';

export async function executePullJob(
  env: Bindings,
  job: PullJobMessage,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(job.api_url, {
      headers: { Authorization: `Bearer ${job.token}` },
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
