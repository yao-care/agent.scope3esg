import { describe, it, expect, vi, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import { applyMigrations } from '../helpers/migrate';
import { insertTenant, insertSupplierToken } from '../../src/db/queries';
import { signSession } from '../../src/lib/session';
import { app } from '../../src/index';
import { getInstallationOctokit } from '../../src/github/app';

vi.mock('../../src/github/app', () => ({
  getInstallationOctokit: vi.fn().mockResolvedValue({ request: vi.fn() }),
}));
vi.mock('../../src/github/config', () => ({
  readTenantConfig: vi.fn().mockResolvedValue({ inventory_year: 2026, enabled_categories: [1], suppliers: [] }),
}));
vi.mock('../../src/handlers/config-push', () => ({
  syncConfig: vi.fn().mockResolvedValue(undefined),
  handleConfigPush: vi.fn().mockResolvedValue(undefined),
}));

async function sessionCookie(org: string) {
  const token = await signSession({ org, user: 'tester', exp: Date.now() + 100000 }, (env as any).SESSION_SECRET);
  return `scope3_session=${token}`;
}

describe('admin API auth', () => {
  beforeAll(async () => {
    await applyMigrations(env.DB);
    await insertTenant(env.DB, { installationId: 900, org: 'acme', repoNodeId: 'R_a' });
    await insertSupplierToken(env.DB, { token: 'stok_1', org: 'acme', supplierId: 'SUP001', expiresAt: '2099-01-01T00:00:00Z' });
  });

  it('rejects requests without a session (401)', async () => {
    const res = await app.request('/api/v1/admin/acme/config', {}, env as any);
    expect(res.status).toBe(401);
  });
  it('rejects session for a different org (401)', async () => {
    const res = await app.request('/api/v1/admin/acme/config', { headers: { Cookie: await sessionCookie('other-org') } }, env as any);
    expect(res.status).toBe(401);
  });
  it('returns config JSON with a valid session', async () => {
    const res = await app.request('/api/v1/admin/acme/config', { headers: { Cookie: await sessionCookie('acme') } }, env as any);
    expect(res.status).toBe(200);
    const body = await res.json<{ inventory_year: number }>();
    expect(body.inventory_year).toBe(2026);
  });
  it('lists supplier links with a valid session', async () => {
    const res = await app.request('/api/v1/admin/acme/links', { headers: { Cookie: await sessionCookie('acme') } }, env as any);
    expect(res.status).toBe(200);
    const body = await res.json<{ links: Array<{ supplierId: string; url: string }> }>();
    expect(body.links.some((l) => l.supplierId === 'SUP001')).toBe(true);
  });
  it('returns supplier overview with form url and submission count', async () => {
    const res = await app.request('/api/v1/admin/acme/overview', { headers: { Cookie: await sessionCookie('acme') } }, env as any);
    expect(res.status).toBe(200);
    const body = await res.json<{ suppliers: Array<{ id: string }> }>();
    expect(Array.isArray(body.suppliers)).toBe(true);
  });

  it('returns pending review count (sub/ × 2 + withdraw/ × 1 = 3)', async () => {
    const mockPRs = [
      { number: 1, title: 'SUP001 sub', head: { ref: 'sub/SUP001/abc' } },
      { number: 2, title: 'SUP002 sub', head: { ref: 'sub/SUP002/def' } },
      { number: 3, title: 'SUP001 withdraw', head: { ref: 'withdraw/SUP001/ghi' } },
    ];
    const mockRequest = vi.fn().mockResolvedValue({ data: mockPRs });
    (getInstallationOctokit as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ request: mockRequest });

    const res = await app.request('/api/v1/admin/acme/review/count', { headers: { Cookie: await sessionCookie('acme') } }, env as any);
    expect(res.status).toBe(200);
    const body = await res.json<{ pending: number }>();
    expect(body.pending).toBe(3);
  });

  it('GET /:org/review/list returns submission PRs with details + validate status', async () => {
    // listOpenPullRequestsByPrefix called twice (sub/, withdraw/)
    // First call (sub/): returns 1 PR with head.sha and labels
    // Second call (withdraw/): returns empty
    // getFileOnBranch call: returns base64-encoded JSON
    // getPullChecks call: returns check-runs with success
    const submissionData = { supplier_id: 'SUP001', scope3_category: 1 };
    const base64Content = btoa(JSON.stringify(submissionData));
    const mockRequest = vi.fn().mockImplementation((route: string, opts: Record<string, unknown>) => {
      if (route === 'GET /repos/{owner}/{repo}/pulls') {
        const allPRs = [
          { number: 7, title: 'SUP001 submission', head: { ref: 'sub/SUP001/aaa', sha: 'sha-abc' }, labels: [] },
        ];
        // filter by head prefix the same way listOpenPullRequestsByPrefix does
        return Promise.resolve({ data: allPRs });
      }
      if (route === 'GET /repos/{owner}/{repo}/contents/{path}') {
        // getFileOnBranch
        return Promise.resolve({ data: { content: base64Content + '\n', sha: 'blob-sha-1' } });
      }
      if (route === 'GET /repos/{owner}/{repo}/commits/{ref}/check-runs') {
        return Promise.resolve({ data: { check_runs: [{ conclusion: 'success' }] } });
      }
      return Promise.resolve({ data: [] });
    });
    (getInstallationOctokit as ReturnType<typeof vi.fn>).mockResolvedValue({ request: mockRequest });

    const res = await app.request('/api/v1/admin/acme/review/list', { headers: { Cookie: await sessionCookie('acme') } }, env as any);
    expect(res.status).toBe(200);
    const body = await res.json<{ reviews: Array<{ type: string; supplier_id: string; validate: string }> }>();
    expect(body.reviews[0]).toMatchObject({ type: 'submission', supplier_id: 'SUP001', validate: 'success' });
  });

  it('POST /:org/review/:pr/approve merges the PR', async () => {
    const mockRequest = vi.fn().mockResolvedValue({ data: {} });
    (getInstallationOctokit as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ request: mockRequest });

    const res = await app.request('/api/v1/admin/acme/review/7/approve', { method: 'POST', headers: { Cookie: await sessionCookie('acme') } }, env as any);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    // verify mergePullRequest was called with correct endpoint and PR number
    expect(mockRequest).toHaveBeenCalledWith(
      'PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge',
      expect.objectContaining({ pull_number: 7 }),
    );
  });

  it('POST /:org/review/:pr/approve returns 409 when merge fails', async () => {
    const mockRequest = vi.fn().mockImplementation((route: string) => {
      if (route === 'PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge') {
        return Promise.reject(new Error('Pull Request is not mergeable'));
      }
      return Promise.resolve({ data: {} });
    });
    (getInstallationOctokit as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ request: mockRequest });

    const res = await app.request('/api/v1/admin/acme/review/7/approve', { method: 'POST', headers: { Cookie: await sessionCookie('acme') } }, env as any);
    expect(res.status).toBe(409);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe('merge failed');
  });

  it('POST /:org/review/:pr/reject adds label + comment with reason', async () => {
    const mockRequest = vi.fn().mockResolvedValue({ data: {} });
    (getInstallationOctokit as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ request: mockRequest });

    const res = await app.request('/api/v1/admin/acme/review/7/reject', {
      method: 'POST',
      headers: { Cookie: await sessionCookie('acme'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: '數量單位錯誤' }),
    }, env as any);
    expect(res.status).toBe(200);
    const body = await res.json<{ ok: boolean }>();
    expect(body.ok).toBe(true);
    // verify addLabelToPR was called with status:revision label
    expect(mockRequest).toHaveBeenCalledWith(
      'POST /repos/{owner}/{repo}/issues/{issue_number}/labels',
      expect.objectContaining({ issue_number: 7, labels: ['status:revision'] }),
    );
    // verify commentOnPR was called with reject marker and reason in body
    const commentCall = mockRequest.mock.calls.find(
      ([route]: [string]) => route === 'POST /repos/{owner}/{repo}/issues/{issue_number}/comments',
    );
    expect(commentCall).toBeDefined();
    const commentBody: string = commentCall![1].body;
    expect(commentBody).toEqual(expect.stringContaining('<!-- reject -->'));
    expect(commentBody).toEqual(expect.stringContaining('數量單位錯誤'));
  });

  it('GET /:org/dashboard-data returns availableYears and filters by year', async () => {
    const submissions = [
      { supplier_id: 'SUP001', scope3_category: 1, activity_type: 'transport', calculated_co2e: 100, period: '2025-Q1' },
      { supplier_id: 'SUP002', scope3_category: 2, activity_type: 'energy', calculated_co2e: 200, period: '2024-Q3' },
    ];
    const base64Content = btoa(JSON.stringify(submissions));
    const mockRequest = vi.fn().mockImplementation((route: string) => {
      if (route === 'GET /repos/{owner}/{repo}/contents/{path}') {
        return Promise.resolve({ data: { content: base64Content + '\n', sha: 'sha-sub' } });
      }
      return Promise.resolve({ data: [] });
    });
    (getInstallationOctokit as ReturnType<typeof vi.fn>).mockResolvedValue({ request: mockRequest });

    const all = await app.request('/api/v1/admin/acme/dashboard-data', { headers: { Cookie: await sessionCookie('acme') } }, env as any);
    const allBody = await all.json<{ availableYears: string[]; submissionCount: number }>();
    expect(allBody.availableYears.slice().sort()).toEqual(['2024', '2025']);
    expect(allBody.submissionCount).toBe(2);

    const y = await app.request('/api/v1/admin/acme/dashboard-data?year=2025', { headers: { Cookie: await sessionCookie('acme') } }, env as any);
    expect((await y.json<{ submissionCount: number }>()).submissionCount).toBe(1);
  });

  it('GET /:org/reports?format=csv returns CSV attachment', async () => {
    const submissions = [
      { submission_id: 'sub-1', supplier_id: 'SUP001', scope3_category: 1, activity_type: 'transport', calculated_co2e: 100, period: '2025-Q1' },
    ];
    const base64Content = btoa(JSON.stringify(submissions));
    const mockRequest = vi.fn().mockImplementation((route: string) => {
      if (route === 'GET /repos/{owner}/{repo}/contents/{path}') {
        return Promise.resolve({ data: { content: base64Content + '\n', sha: 'sha-sub' } });
      }
      return Promise.resolve({ data: [] });
    });
    (getInstallationOctokit as ReturnType<typeof vi.fn>).mockResolvedValue({ request: mockRequest });

    const res = await app.request('/api/v1/admin/acme/reports?format=csv', { headers: { Cookie: await sessionCookie('acme') } }, env as any);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toContain('attachment');
    expect(await res.text()).toContain('submission_id,supplier_id');
  });

  it('GET /:org/reports?format=md&year=2025 returns markdown filtered by year', async () => {
    const submissions = [
      { submission_id: 'sub-1', supplier_id: 'SUP001', scope3_category: 1, activity_type: 'transport', calculated_co2e: 100, period: '2025-Q1' },
      { submission_id: 'sub-2', supplier_id: 'SUP002', scope3_category: 2, activity_type: 'energy', calculated_co2e: 200, period: '2024-Q3' },
    ];
    const base64Content = btoa(JSON.stringify(submissions));
    const mockRequest = vi.fn().mockImplementation((route: string) => {
      if (route === 'GET /repos/{owner}/{repo}/contents/{path}') {
        return Promise.resolve({ data: { content: base64Content + '\n', sha: 'sha-sub' } });
      }
      return Promise.resolve({ data: [] });
    });
    (getInstallationOctokit as ReturnType<typeof vi.fn>).mockResolvedValue({ request: mockRequest });

    const res = await app.request('/api/v1/admin/acme/reports?format=md&year=2025', { headers: { Cookie: await sessionCookie('acme') } }, env as any);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/markdown');
    expect(await res.text()).toContain('盤點年度：2025');
  });
});
