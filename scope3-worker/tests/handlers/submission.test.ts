import { describe, it, expect, vi, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import { applyMigrations } from '../helpers/migrate';
import { insertSupplierToken } from '../../src/db/queries';
import { processSubmission } from '../../src/handlers/submission';

vi.mock('../../src/github/app', () => ({
  getInstallationOctokit: vi.fn().mockResolvedValue({ request: vi.fn() }),
}));

vi.mock('../../src/github/issue', () => ({
  createSubmissionIssue: vi.fn().mockResolvedValue(99),
}));

vi.mock('../../src/db/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/db/queries')>();
  return {
    ...actual,
    getTenant: vi.fn().mockResolvedValue({ installationId: 1, org: 'acme-corp' }),
  };
});

describe('processSubmission', () => {
  beforeAll(async () => {
    await applyMigrations(env.DB);
    // Insert real tenant row so processSubmission's direct D1 query succeeds
    await env.DB.prepare(
      "INSERT OR IGNORE INTO tenants (installation_id, org, repo_node_id, created_at) VALUES (1, 'acme-corp', 'R_test', ?)"
    ).bind(new Date().toISOString()).run();
    await insertSupplierToken(env.DB, {
      token:      'tok_valid',
      org:        'acme-corp',
      supplierId: 'SUP001',
      expiresAt:  '2099-01-01T00:00:00Z',
    });
  });

  it('returns issue number on valid submission', async () => {
    const result = await processSubmission(env as any, {
      org:           'acme-corp',
      supplierToken: 'tok_valid',
      data: {
        scope3_category: 1,
        period:          '2025-Q1',
        activity_type:   'electricity',
        amount:          10000,
        unit:            'kWh',
        evidence_urls:   [],
      },
      channel: 'api',
    });
    expect(result.success).toBe(true);
    expect(result.issueNumber).toBe(99);
  });

  it('returns error for invalid token', async () => {
    const result = await processSubmission(env as any, {
      org:           'acme-corp',
      supplierToken: 'tok_bad',
      data: {
        scope3_category: 1,
        period:          '2025-Q1',
        activity_type:   'electricity',
        amount:          100,
        unit:            'kWh',
        evidence_urls:   [],
      },
      channel: 'api',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/invalid token/i);
  });
});
