import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTenantRepo } from '../../src/github/repo';
import { TENANT_FILES } from '../../src/templates/generated';

function makeOctokit() {
  return {
    request: vi.fn(async (route: string) => {
      if (route === 'POST /orgs/{org}/repos') return { data: { node_id: 'R_test123' } };
      return { data: {} };
    }),
  };
}

describe('createTenantRepo', () => {
  let octokit: ReturnType<typeof makeOctokit>;
  beforeEach(() => {
    octokit = makeOctokit();
  });

  it('creates the repo and returns its node_id', async () => {
    const nodeId = await createTenantRepo(octokit as any, 'acme-corp');
    expect(nodeId).toBe('R_test123');
    expect(octokit.request).toHaveBeenCalledWith(
      'POST /orgs/{org}/repos',
      expect.objectContaining({ org: 'acme-corp', name: 'scope3-inventory' }),
    );
  });

  it('commits every tenant-template file via PUT contents', async () => {
    await createTenantRepo(octokit as any, 'acme-corp');
    const putCalls = octokit.request.mock.calls.filter(
      (c) => c[0] === 'PUT /repos/{owner}/{repo}/contents/{path}',
    );
    const committedPaths = putCalls.map((c) => c[1].path).sort();
    expect(committedPaths).toEqual(Object.keys(TENANT_FILES).sort());
    expect(committedPaths).toContain('.github/workflows/validate.yml');
    expect(committedPaths).toContain('.github/workflows/calculate.yml');
    expect(committedPaths).toContain('scripts/lib.mjs');
    expect(committedPaths).toContain('data/emission-factors.json');
  });

  it('creates all 22 labels', async () => {
    await createTenantRepo(octokit as any, 'acme-corp');
    const labelCalls = octokit.request.mock.calls.filter(
      (c) => c[0] === 'POST /repos/{owner}/{repo}/labels',
    );
    expect(labelCalls.length).toBe(22);
  });
});
