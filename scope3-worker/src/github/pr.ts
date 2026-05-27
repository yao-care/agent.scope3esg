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

export interface OpenPR { number: number; title: string; head: { ref: string; sha: string }; labels: { name: string }[]; }

export async function listOpenPullRequestsByPrefix(octokit: Octokit, org: string, headPrefix: string): Promise<OpenPR[]> {
  try {
    const res = await octokit.request('GET /repos/{owner}/{repo}/pulls', {
      owner: org, repo: REPO, state: 'open', per_page: 100,
    });
    const prs = (res?.data as OpenPR[] | undefined) ?? [];
    return prs.filter((p) => p.head?.ref?.startsWith(headPrefix));
  } catch {
    return []; // PR 清單讀取失敗（repo 不可讀/網路），視為無待審
  }
}

export async function closePullRequest(octokit: Octokit, org: string, prNumber: number): Promise<void> {
  await octokit.request('PATCH /repos/{owner}/{repo}/pulls/{pull_number}', {
    owner: org, repo: REPO, pull_number: prNumber, state: 'closed',
  });
}

export async function deleteBranch(octokit: Octokit, org: string, branch: string): Promise<void> {
  await octokit.request('DELETE /repos/{owner}/{repo}/git/refs/{ref}', {
    owner: org, repo: REPO, ref: `heads/${branch}`,
  });
}

// 取 main 上某路徑檔案的 sha（更新/刪除需要）
export async function getFileSha(octokit: Octokit, org: string, path: string): Promise<string | null> {
  try {
    const { data } = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', { owner: org, repo: REPO, path });
    return (data as { sha?: string }).sha ?? null;
  } catch {
    return null;
  }
}

// 在分支上刪除檔案（撤回已核定：開分支刪 main 檔 → PR）
export async function deleteFileViaBranch(octokit: Octokit, org: string, branch: string, path: string, sha: string, message: string): Promise<void> {
  await octokit.request('DELETE /repos/{owner}/{repo}/contents/{path}', {
    owner: org, repo: REPO, path, message, sha, branch,
  });
}

// 讀分支上某檔的 JSON 內容與 blob sha（審核詳情／原地編輯用）。
export async function getFileOnBranch(
  octokit: Octokit, org: string, branch: string, path: string,
): Promise<{ data: Record<string, unknown>; sha: string } | null> {
  try {
    const { data } = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
      owner: org, repo: REPO, path, ref: branch,
    });
    const d = data as { content?: string; sha?: string };
    if (!d.content || !d.sha) return null;
    const bytes = Uint8Array.from(atob(d.content.replace(/\n/g, '')), (c) => c.charCodeAt(0));
    return { data: JSON.parse(new TextDecoder('utf-8').decode(bytes)), sha: d.sha };
  } catch {
    return null;
  }
}

// 查某 commit 的 check-runs 結論，映射為 validate 狀態三態。
// 需 App Checks:Read；無權限／查無一律回 'pending'（灰／驗證中），不阻擋主流程。
export async function getPullChecks(octokit: Octokit, org: string, sha: string): Promise<'success' | 'failure' | 'pending'> {
  try {
    const { data } = await octokit.request('GET /repos/{owner}/{repo}/commits/{ref}/check-runs', {
      owner: org, repo: REPO, ref: sha,
    });
    const runs = (data as { check_runs?: Array<{ conclusion: string | null }> }).check_runs ?? [];
    if (runs.length === 0) return 'pending';
    if (runs.some((r) => r.conclusion === 'failure')) return 'failure';
    if (runs.every((r) => r.conclusion === 'success')) return 'success';
    return 'pending';
  } catch {
    return 'pending';
  }
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
