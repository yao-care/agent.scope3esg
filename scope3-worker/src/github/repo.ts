import type { Octokit } from '@octokit/core';
import { TENANT_FILES } from '../templates/generated';

const LABELS = [
  { name: 'status:submitted',   color: '0075ca', description: '已提交，等待審核' },
  { name: 'status:reviewing',   color: 'e4e669', description: '審核中' },
  { name: 'status:revision',    color: 'd93f0b', description: '需補件' },
  { name: 'status:approved',    color: '0e8a16', description: '已核定' },
  { name: 'status:archived',    color: 'cfd3d7', description: '已歸檔' },
  { name: 'validation:warning', color: 'fbca04', description: '驗證警告' },
  { name: 'validation:error',   color: 'b60205', description: '驗證錯誤' },
  ...Array.from({ length: 15 }, (_, i) => ({
    name:        `cat:${i + 1}`,
    color:       '1d76db',
    description: `Scope 3 Category ${i + 1}`,
  })),
];

function toBase64(text: string): string {
  return btoa(unescape(encodeURIComponent(text)));
}

export async function createTenantRepo(octokit: Octokit, org: string): Promise<string> {
  let repo: { node_id: string };
  try {
    const res = await octokit.request('POST /orgs/{org}/repos', {
      org,
      name:        'scope3-inventory',
      description: 'Scope 3 碳排資料盤點系統（由 Scope3 GitHub App 管理）',
      private:     true,
      auto_init:   false,
    });
    repo = res.data;
  } catch (err) {
    // repo 已存在（重複安裝或 webhook 重送）→ 視為冪等：取得現有 repo 並跳過初始寫入。
    // 檔案與 labels 在首次建立時已寫入，無需重複。
    if ((err as { status?: number }).status === 422) {
      const { data: existing } = await octokit.request('GET /repos/{owner}/{repo}', {
        owner: org,
        repo:  'scope3-inventory',
      });
      return existing.node_id;
    }
    throw err;
  }

  for (const [path, content] of Object.entries(TENANT_FILES)) {
    await octokit.request('PUT /repos/{owner}/{repo}/contents/{path}', {
      owner:   org,
      repo:    'scope3-inventory',
      path,
      message: `chore: add ${path}`,
      content: toBase64(content),
    });
  }

  for (const label of LABELS) {
    await octokit.request('POST /repos/{owner}/{repo}/labels', {
      owner: org,
      repo:  'scope3-inventory',
      ...label,
    });
  }

  return repo.node_id;
}
