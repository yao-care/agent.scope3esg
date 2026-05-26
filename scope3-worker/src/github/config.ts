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
    // GitHub 回傳 base64。atob 只解成 Latin-1 binary string，會讓 UTF-8（如中文供應商名）變亂碼
    // 並使 yamlLoad 解析失敗，因此須以 TextDecoder 正確解回 UTF-8。
    const b64 = data.content.replace(/\n/g, '');
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const yaml = new TextDecoder('utf-8').decode(bytes);
    return yamlLoad(yaml) as TenantConfig;
  } catch {
    return null;
  }
}
