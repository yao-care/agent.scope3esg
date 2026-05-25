import { describe, it, expect, vi, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import { applyMigrations } from '../helpers/migrate';
import { handleConfigPush } from '../../src/handlers/config-push';
import type { GitHubPushPayload } from '../../src/types';

vi.mock('../../src/github/app', () => ({
  getInstallationOctokit: vi.fn().mockResolvedValue({ request: vi.fn() }),
}));

vi.mock('../../src/github/config', () => ({
  readTenantConfig: vi.fn().mockResolvedValue({
    inventory_year:      2025,
    enabled_categories:  [1, 4],
    suppliers: [
      { id: 'SUP001', name: '台鋼', contact: 'esg@twsteel.com', pull_api: null, pull_schedule: null },
    ],
  }),
}));

vi.mock('../../src/email/resend', () => ({
  sendOnboardingEmail: vi.fn().mockResolvedValue(undefined),
}));

const pushPayload: GitHubPushPayload = {
  ref:        'refs/heads/main',
  repository: { name: 'scope3-inventory', owner: { login: 'acme-corp' } },
  commits:    [{ added: [], modified: ['config.yml'] }],
  installation: { id: 1 },
};

describe('handleConfigPush', () => {
  beforeAll(async () => {
    await applyMigrations(env.DB);
    await env.DB.prepare(
      "INSERT OR IGNORE INTO tenants VALUES (1, 'acme-corp', 'R_test', ?)"
    ).bind(new Date().toISOString()).run();
  });

  it('generates tokens for new suppliers and sends emails', async () => {
    const { sendOnboardingEmail } = await import('../../src/email/resend');
    await handleConfigPush(env as any, pushPayload);

    const token = await env.DB
      .prepare("SELECT * FROM supplier_tokens WHERE org = 'acme-corp' AND supplier_id = 'SUP001'")
      .first();

    expect(token).not.toBeNull();
    expect(sendOnboardingEmail).toHaveBeenCalledOnce();
  });

  it('does not duplicate tokens for existing suppliers', async () => {
    const { sendOnboardingEmail } = await import('../../src/email/resend');
    vi.mocked(sendOnboardingEmail).mockClear();

    await handleConfigPush(env as any, pushPayload);

    const tokens = await env.DB
      .prepare("SELECT * FROM supplier_tokens WHERE org = 'acme-corp' AND supplier_id = 'SUP001'")
      .all();

    expect(tokens.results.length).toBe(1);
    expect(sendOnboardingEmail).not.toHaveBeenCalled();
  });
});
