import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTenantRepo } from '../../src/github/repo';

const mockOctokit = {
  request: vi.fn(),
};

describe('createTenantRepo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates repo, commits config.yml, and creates labels', async () => {
    mockOctokit.request
      .mockResolvedValueOnce({ data: { node_id: 'R_abc123' } }) // POST /orgs/{org}/repos
      .mockResolvedValue({ data: {} }); // all subsequent calls

    const nodeId = await createTenantRepo(mockOctokit as any, 'test-org');

    expect(nodeId).toBe('R_abc123');

    expect(mockOctokit.request).toHaveBeenCalledWith(
      'POST /orgs/{org}/repos',
      expect.objectContaining({ org: 'test-org', name: 'scope3-inventory' }),
    );

    expect(mockOctokit.request).toHaveBeenCalledWith(
      'PUT /repos/{owner}/{repo}/contents/{path}',
      expect.objectContaining({ path: 'config.yml' }),
    );

    const labelCalls = mockOctokit.request.mock.calls.filter(
      ([route]: [string]) => route === 'POST /repos/{owner}/{repo}/labels',
    );
    expect(labelCalls.length).toBeGreaterThanOrEqual(20);
  });
});
