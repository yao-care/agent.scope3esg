import { describe, it, expect, vi, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import { applyMigrations } from '../helpers/migrate';
import { handleInstallation } from '../../src/handlers/installation';
import type { GitHubInstallationPayload } from '../../src/types';

vi.mock('../../src/github/app', () => ({
  getInstallationOctokit: vi.fn().mockResolvedValue({
    request: vi.fn()
      .mockResolvedValueOnce({ data: { node_id: 'R_test' } })
      .mockResolvedValue({ data: {} }),
  }),
}));

vi.mock('../../src/github/repo', () => ({
  createTenantRepo: vi.fn().mockResolvedValue('R_test'),
}));

describe('handleInstallation', () => {
  beforeAll(async () => {
    await applyMigrations(env.DB);
  });

  const payload: GitHubInstallationPayload = {
    action: 'created',
    installation: {
      id: 999,
      account: { login: 'acme-corp', type: 'Organization' },
    },
  };

  it('inserts tenant into D1 on installation.created', async () => {
    await handleInstallation(env as any, payload);

    const result = await env.DB.prepare(
      'SELECT * FROM tenants WHERE installation_id = 999',
    ).first();

    expect(result).not.toBeNull();
    expect(result?.org).toBe('acme-corp');
    expect(result?.repo_node_id).toBe('R_test');
  });

  it('does nothing on installation.deleted', async () => {
    const deletedPayload = { ...payload, action: 'deleted' as const };
    await handleInstallation(env as any, deletedPayload);

    const count = await env.DB.prepare(
      'SELECT count(*) as cnt FROM tenants',
    ).first<{ cnt: number }>();
    expect(count?.cnt).toBe(1); // 只有前一個 test 插入的那一筆
  });
});
