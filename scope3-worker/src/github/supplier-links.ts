import type { Octokit } from '@octokit/core';
import type { SupplierConfig } from '../types';

export function buildSupplierLinksMarkdown(
  baseUrl: string,
  org: string,
  suppliers: SupplierConfig[],
  tokenBySupplierId: Record<string, string>,
): string {
  const rows = suppliers
    .map((s) => {
      const token = tokenBySupplierId[s.id];
      const url = token ? `${baseUrl}/submit/${org}/${token}` : '（尚未產生）';
      return `| ${s.name} | ${s.id} | ${s.contact ?? ''} | ${url} |`;
    })
    .join('\n');

  return `# 供應商填表連結

> ⚠️ 機密：以下連結等同存取權杖，僅於此 private repo 內共享，請勿公開張貼。
> 將對應連結傳給各供應商，供其提交 Scope 3 碳排資料。

| 供應商 | ID | 聯絡 | 專屬填表連結 |
|------|----|------|------|
${rows}
`;
}

export async function upsertSupplierLinks(
  octokit: Octokit,
  org: string,
  markdown: string,
): Promise<void> {
  let sha: string | undefined;
  try {
    const res = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
      owner: org,
      repo:  'scope3-inventory',
      path:  'supplier-links.md',
    });
    const data = res?.data as { sha?: string } | undefined;
    if (data && typeof data.sha === 'string') sha = data.sha;
  } catch {
    // 檔案不存在 → 建立新檔
  }

  await octokit.request('PUT /repos/{owner}/{repo}/contents/{path}', {
    owner:   org,
    repo:    'scope3-inventory',
    path:    'supplier-links.md',
    message: 'chore: update supplier submission links',
    content: btoa(unescape(encodeURIComponent(markdown))),
    ...(sha ? { sha } : {}),
  });
}
