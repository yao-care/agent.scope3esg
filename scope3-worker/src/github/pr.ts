// src/github/pr.ts
// branch/PR 盤查模型的 GitHub 操作。租戶 repo 固定為 scope3-inventory。
import type { Octokit } from '@octokit/core';

const REPO = 'scope3-inventory';

function toBase64(text: string): string {
  return btoa(unescape(encodeURIComponent(text)));
}

export async function getMainSha(octokit: Octokit, org: string): Promise<string> {
  const { data } = await octokit.request('GET /repos/{owner}/{repo}/git/ref/{ref}', {
    owner: org, repo: REPO, ref: 'heads/main',
  });
  return (data as { object: { sha: string } }).object.sha;
}

export async function createBranch(octokit: Octokit, org: string, branch: string, fromSha: string): Promise<void> {
  await octokit.request('POST /repos/{owner}/{repo}/git/refs', {
    owner: org, repo: REPO, ref: `refs/heads/${branch}`, sha: fromSha,
  });
}

export async function commitFileToBranch(octokit: Octokit, org: string, branch: string, path: string, content: string, message: string): Promise<void> {
  await octokit.request('PUT /repos/{owner}/{repo}/contents/{path}', {
    owner: org, repo: REPO, path, message, content: toBase64(content), branch,
  });
}

export async function openPullRequest(octokit: Octokit, org: string, branch: string, title: string, body: string): Promise<number> {
  const { data } = await octokit.request('POST /repos/{owner}/{repo}/pulls', {
    owner: org, repo: REPO, head: branch, base: 'main', title, body,
  });
  return (data as { number: number }).number;
}

export interface OpenPR { number: number; title: string; head: { ref: string }; }

export async function listOpenPullRequestsByPrefix(octokit: Octokit, org: string, headPrefix: string): Promise<OpenPR[]> {
  const { data } = await octokit.request('GET /repos/{owner}/{repo}/pulls', {
    owner: org, repo: REPO, state: 'open', per_page: 100,
  });
  const prs = data as OpenPR[];
  return prs.filter((p) => p.head?.ref?.startsWith(headPrefix));
}

export async function listSupplierSubmissions(octokit: Octokit, org: string, supplierId: string): Promise<Record<string, unknown>[]> {
  let listing: Array<{ name: string; path: string; type: string }>;
  try {
    const { data } = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
      owner: org, repo: REPO, path: `submissions/${supplierId}`,
    });
    if (!Array.isArray(data)) return [];
    listing = data as Array<{ name: string; path: string; type: string }>;
  } catch {
    return []; // 目錄不存在（尚無已核定提交）
  }
  const out: Record<string, unknown>[] = [];
  for (const f of listing) {
    if (f.type !== 'file' || !f.name.endsWith('.json')) continue;
    try {
      const { data } = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', { owner: org, repo: REPO, path: f.path });
      const content = (data as { content?: string }).content;
      if (!content) continue;
      const bytes = Uint8Array.from(atob(content.replace(/\n/g, '')), (c) => c.charCodeAt(0));
      out.push(JSON.parse(new TextDecoder('utf-8').decode(bytes)));
    } catch { /* skip */ }
  }
  return out;
}
