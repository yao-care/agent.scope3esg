import type { Octokit } from '@octokit/core';
import { load as yamlLoad } from 'js-yaml';
import type { TenantConfig } from '../types';

export async function readTenantConfig(octokit: Octokit, org: string): Promise<TenantConfig | null> {
  try {
    const { data } = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
      owner: org,
      repo:  'scope3-inventory',
      path:  'config.yml',
    });
    if (!('content' in data)) return null;
    const yaml = atob(data.content.replace(/\n/g, ''));
    return yamlLoad(yaml) as TenantConfig;
  } catch {
    return null;
  }
}
