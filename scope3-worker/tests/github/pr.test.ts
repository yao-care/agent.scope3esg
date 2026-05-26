import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getMainSha, createBranch, commitFileToBranch, openPullRequest, listOpenPullRequestsByPrefix } from '../../src/github/pr';

function makeOctokit() {
  return {
    request: vi.fn(async (route: string) => {
      if (route === 'GET /repos/{owner}/{repo}/git/ref/{ref}') return { data: { object: { sha: 'mainsha123' } } };
      if (route === 'POST /repos/{owner}/{repo}/git/refs') return { data: {} };
      if (route === 'PUT /repos/{owner}/{repo}/contents/{path}') return { data: { commit: { sha: 'c1' } } };
      if (route === 'POST /repos/{owner}/{repo}/pulls') return { data: { number: 7 } };
      if (route === 'GET /repos/{owner}/{repo}/pulls') return { data: [
        { number: 7, title: '[S1] x', head: { ref: 'sub/SUP001/aaa' } },
        { number: 8, title: '[S2] y', head: { ref: 'sub/SUP002/bbb' } },
      ] };
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
});
