import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import { applyMigrations } from '../helpers/migrate';
import { upsertPullJob, listAllPullJobs, touchPullJobLastRun, insertAuditLog, listAuditLogByOrg } from '../../src/db/queries';

describe('pull_jobs queries', () => {
  beforeAll(async () => { await applyMigrations(env.DB); });

  it('upserts and lists pull jobs', async () => {
    await upsertPullJob(env.DB, { jobId: 'acme:SUP001', org: 'acme', supplierId: 'SUP001', apiUrl: 'https://api.x/esg', schedule: '0 9 * * 1', apiToken: null });
    const jobs = await listAllPullJobs(env.DB);
    expect(jobs.some((j) => j.jobId === 'acme:SUP001')).toBe(true);
  });
  it('upsert is idempotent on jobId and updates apiUrl', async () => {
    await upsertPullJob(env.DB, { jobId: 'acme:SUP001', org: 'acme', supplierId: 'SUP001', apiUrl: 'https://api.x/v2', schedule: '0 9 * * 1', apiToken: null });
    const jobs = (await listAllPullJobs(env.DB)).filter((j) => j.jobId === 'acme:SUP001');
    expect(jobs.length).toBe(1);
    expect(jobs[0].apiUrl).toBe('https://api.x/v2');
  });
  it('touchPullJobLastRun sets last_run_at', async () => {
    await touchPullJobLastRun(env.DB, 'acme:SUP001');
    const job = (await listAllPullJobs(env.DB)).find((j) => j.jobId === 'acme:SUP001');
    expect(job?.lastRunAt).toBeTruthy();
  });
});

describe('audit_log queries', () => {
  beforeAll(async () => { await applyMigrations(env.DB); });

  it('inserts and lists audit entries by org', async () => {
    await insertAuditLog(env.DB, { org: 'acme', action: 'submission_created', actor: 'SUP001', target: 'issue#5' });
    const rows = await listAuditLogByOrg(env.DB, 'acme');
    expect(rows.some((r) => r.action === 'submission_created' && r.target === 'issue#5')).toBe(true);
  });
});
