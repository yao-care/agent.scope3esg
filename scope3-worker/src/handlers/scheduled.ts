// src/handlers/scheduled.ts
// 由 cron 觸發：掃描所有 pull_jobs，為每個排訊息進 SUBMISSION_QUEUE，由 consumer 拉供應商 API。
import { listAllPullJobs, touchPullJobLastRun, listSupplierTokensByOrg } from '../db/queries';
import type { Bindings } from '../types';

export async function handleScheduled(env: Bindings): Promise<void> {
  const jobs = await listAllPullJobs(env.DB);
  for (const job of jobs) {
    const tokens = await listSupplierTokensByOrg(env.DB, job.org);
    const tok = tokens.find((t) => t.supplierId === job.supplierId);
    if (!tok) {
      console.warn('[scheduled] no supplier token for ' + job.org + '/' + job.supplierId + '; skipping');
      continue;
    }
    await env.SUBMISSION_QUEUE.send({ org: job.org, supplier_id: job.supplierId, api_url: job.apiUrl, token: tok.token });
    await touchPullJobLastRun(env.DB, job.jobId);
  }
}
