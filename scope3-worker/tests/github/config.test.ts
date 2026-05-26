import { describe, it, expect, vi } from 'vitest';
import { readTenantConfig } from '../../src/github/config';

function b64utf8(s: string): string {
  return Buffer.from(s, 'utf-8').toString('base64');
}

describe('readTenantConfig', () => {
  it('decodes a UTF-8 (Chinese) config.yml correctly', async () => {
    const yaml = `inventory_year: 2026
enabled_categories: [1, 4]
suppliers:
  - id: DEMO001
    name: 示範供應商（測試用）
    contact: demo@example.com
    pull_api: null
    pull_schedule: null
`;
    const octokit = { request: vi.fn().mockResolvedValue({ data: { content: b64utf8(yaml) } }) };
    const config = await readTenantConfig(octokit as any, 'acme');
    expect(config?.inventory_year).toBe(2026);
    expect(config?.suppliers).toHaveLength(1);
    expect(config?.suppliers[0].id).toBe('DEMO001');
    expect(config?.suppliers[0].name).toBe('示範供應商（測試用）');
  });

  it('returns null when content is missing', async () => {
    const octokit = { request: vi.fn().mockResolvedValue({ data: {} }) };
    expect(await readTenantConfig(octokit as any, 'acme')).toBeNull();
  });
});
