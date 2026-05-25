import type { Octokit } from '@octokit/core';

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

const CONFIG_YML = `inventory_year: ${new Date().getFullYear()}
enabled_categories: [1, 4, 6, 7, 11]

suppliers: []
  # - id: SUP001
  #   name: 供應商名稱
  #   contact: esg@supplier.com
  #   pull_api: null
  #   pull_schedule: null
`;

const ISSUE_TEMPLATE = `name: Scope 3 Data Submission
description: 供應商碳排資料提交
body:
  - type: textarea
    id: data
    attributes:
      label: Submission Data (JSON)
      description: 由系統自動填入，請勿手動編輯
    validations:
      required: true
`;

export async function createTenantRepo(octokit: Octokit, org: string): Promise<string> {
  const { data: repo } = await octokit.request('POST /orgs/{org}/repos', {
    org,
    name:        'scope3-inventory',
    description: 'Scope 3 碳排資料盤點系統（由 Scope3 GitHub App 管理）',
    private:     true,
    auto_init:   false,
  });

  await octokit.request('PUT /repos/{owner}/{repo}/contents/{path}', {
    owner:   org,
    repo:    'scope3-inventory',
    path:    'config.yml',
    message: 'chore: initialize Scope 3 inventory',
    content: btoa(unescape(encodeURIComponent(CONFIG_YML))),
  });

  await octokit.request('PUT /repos/{owner}/{repo}/contents/{path}', {
    owner:   org,
    repo:    'scope3-inventory',
    path:    '.github/ISSUE_TEMPLATE/scope3-submission.yml',
    message: 'chore: add issue template',
    content: btoa(unescape(encodeURIComponent(ISSUE_TEMPLATE))),
  });

  for (const label of LABELS) {
    await octokit.request('POST /repos/{owner}/{repo}/labels', {
      owner: org,
      repo:  'scope3-inventory',
      ...label,
    });
  }

  return repo.node_id;
}
