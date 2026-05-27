import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getMainSha, createBranch, commitFileToBranch, openPullRequest, listOpenPullRequestsByPrefix, listSupplierSubmissions, closePullRequest, deleteBranch, getFileOnBranch, getPullChecks } from '../../src/github/pr';

function makeOctokit() {
  return {
    request: vi.fn(async (route: string, params?: any) => {
      if (route === 'GET /repos/{owner}/{repo}/git/ref/{ref}') return { data: { object: { sha: 'mainsha123' } } };
      if (route === 'POST /repos/{owner}/{repo}/git/refs') return { data: {} };
      if (route === 'PUT /repos/{owner}/{repo}/contents/{path}') return { data: { commit: { sha: 'c1' } } };
      if (route === 'POST /repos/{owner}/{repo}/pulls') return { data: { number: 7 } };
      if (route === 'PATCH /repos/{owner}/{repo}/pulls/{pull_number}') return { data: { state: 'closed' } };
      if (route === 'DELETE /repos/{owner}/{repo}/git/refs/{ref}') return { data: {} };
      if (route === 'DELETE /repos/{owner}/{repo}/contents/{path}') return { data: {} };
      if (route === 'GET /repos/{owner}/{repo}/pulls') return { data: [
        { number: 7, title: '[S1] x', head: { ref: 'sub/SUP001/aaa', sha: 'abc123' }, labels: [{ name: 'status:revision' }] },
        { number: 8, title: '[S2] y', head: { ref: 'sub/SUP002/bbb', sha: 'def456' }, labels: [] },
      ] };
      if (route === 'GET /repos/{owner}/{repo}/contents/{path}' && params?.path === 'submissions/SUP001') {
        return { data: [{ name: 'a.json', path: 'submissions/SUP001/a.json', type: 'file' }] };
      }
      if (route === 'GET /repos/{owner}/{repo}/contents/{path}' && params?.path === 'submissions/SUP001/a.json') {
        const json = JSON.stringify({ submission_id: 'a', supplier_id: 'SUP001', scope3_category: 1, period: '2025-Q1', activity_type: 'electricity', amount: 100, unit: 'kWh' });
        return { data: { content: Buffer.from(json, 'utf-8').toString('base64') } };
      }
      if (route === 'GET /repos/{owner}/{repo}/contents/{path}' && params?.ref === 'sub/SUP001/aaa') {
        const json = JSON.stringify({ submission_id: 'aaa', supplier_id: 'SUP001', scope3_category: 1, period: '2025-Q1', activity_type: 'electricity', amount: 100, unit: 'kWh' });
        return { data: { content: Buffer.from(json, 'utf-8').toString('base64'), sha: 'blobsha1' } };
      }
      if (route === 'GET /repos/{owner}/{repo}/commits/{ref}/check-runs') {
        return { data: { check_runs: [{ conclusion: 'success' }] } };
      }
      return { data: {} };
    }),
  };
}

describe('pr helpers', () => {
  let octokit: ReturnType<typeof makeOctokit>;
  beforeEach(() => { octokit = makeOctokit(); });

  it('getMainSha returns the main ref sha', async () => {
    const sha = await getMainSha(octokit as any, 'acme');
    expect(sha).toBe('mainsha123');
    expect(octokit.request).toHaveBeenCalledWith('GET /repos/{owner}/{repo}/git/ref/{ref}', expect.objectContaining({ owner: 'acme', repo: 'scope3-inventory', ref: 'heads/main' }));
  });

  it('createBranch posts a new ref', async () => {
    await createBranch(octokit as any, 'acme', 'sub/SUP001/aaa', 'mainsha123');
    expect(octokit.request).toHaveBeenCalledWith('POST /repos/{owner}/{repo}/git/refs', expect.objectContaining({ owner: 'acme', repo: 'scope3-inventory', ref: 'refs/heads/sub/SUP001/aaa', sha: 'mainsha123' }));
  });

  it('commitFileToBranch puts content on the branch (base64)', async () => {
    await commitFileToBranch(octokit as any, 'acme', 'sub/SUP001/aaa', 'submissions/SUP001/aaa.json', '{"x":1}', 'add submission');
    const call = octokit.request.mock.calls.find((c) => c[0] === 'PUT /repos/{owner}/{repo}/contents/{path}');
    expect(call[1]).toMatchObject({ owner: 'acme', repo: 'scope3-inventory', path: 'submissions/SUP001/aaa.json', branch: 'sub/SUP001/aaa' });
    expect(typeof call[1].content).toBe('string'); // base64
  });

  it('openPullRequest returns the PR number', async () => {
    const num = await openPullRequest(octokit as any, 'acme', 'sub/SUP001/aaa', '[S1] Cat.1', 'body');
    expect(num).toBe(7);
    expect(octokit.request).toHaveBeenCalledWith('POST /repos/{owner}/{repo}/pulls', expect.objectContaining({ owner: 'acme', repo: 'scope3-inventory', head: 'sub/SUP001/aaa', base: 'main', title: '[S1] Cat.1' }));
  });

  it('listOpenPullRequestsByPrefix filters by head branch prefix', async () => {
    const prs = await listOpenPullRequestsByPrefix(octokit as any, 'acme', 'sub/SUP001/');
    expect(prs.length).toBe(1);
    expect(prs[0].number).toBe(7);
  });

  it('closePullRequest patches state closed', async () => {
    await closePullRequest(octokit as any, 'acme', 7);
    expect(octokit.request).toHaveBeenCalledWith('PATCH /repos/{owner}/{repo}/pulls/{pull_number}', expect.objectContaining({ owner: 'acme', repo: 'scope3-inventory', pull_number: 7, state: 'closed' }));
  });
  it('deleteBranch deletes the ref', async () => {
    await deleteBranch(octokit as any, 'acme', 'sub/SUP001/aaa');
    expect(octokit.request).toHaveBeenCalledWith('DELETE /repos/{owner}/{repo}/git/refs/{ref}', expect.objectContaining({ owner: 'acme', repo: 'scope3-inventory', ref: 'heads/sub/SUP001/aaa' }));
  });

  it('listOpenPullRequestsByPrefix carries head.sha and labels', async () => {
    const prs = await listOpenPullRequestsByPrefix(octokit as any, 'acme', 'sub/');
    expect(prs.length).toBeGreaterThan(0);
    expect(typeof prs[0].head.sha).toBe('string');
    expect(Array.isArray(prs[0].labels)).toBe(true);
  });

  it('listSupplierSubmissions reads merged submission files for a supplier', async () => {
    const subs = await listSupplierSubmissions(octokit as any, 'acme', 'SUP001');
    expect(subs.length).toBe(1);
    expect(subs[0].submission_id).toBe('a');
    expect(subs[0].period).toBe('2025-Q1');
  });

  it('getFileOnBranch returns parsed JSON and blob sha', async () => {
    const r = await getFileOnBranch(octokit as any, 'acme', 'sub/SUP001/aaa', 'submissions/SUP001/aaa.json');
    expect(r).not.toBeNull();
    expect(r!.sha).toBe('blobsha1');
    expect((r!.data as any).period).toBe('2025-Q1');
  });

  it('getPullChecks maps check-run conclusions to a status', async () => {
    expect(await getPullChecks(octokit as any, 'acme', 'anysha')).toBe('success');
  });
});
