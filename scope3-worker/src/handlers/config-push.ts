import { getInstallationOctokit } from '../github/app';
import { readTenantConfig } from '../github/config';
import { listSupplierTokensByOrg, insertSupplierToken } from '../db/queries';
import { sendOnboardingEmail } from '../email/resend';
import { generateToken, generateFormUrl, tokenExpiresAt } from '../lib/tokens';
import { buildSupplierLinksMarkdown, upsertSupplierLinks } from '../github/supplier-links';
import type { Bindings, GitHubPushPayload } from '../types';

// 核心：讀 config.yml → 為新供應商產 token → 寫回 supplier-links.md。
// 由 webhook push 與 config-sync 端點共用。
export async function syncConfig(env: Bindings, org: string, installationId: number): Promise<void> {
  const octokit = await getInstallationOctokit(env, installationId);
  const config  = await readTenantConfig(octokit, org);
  if (!config) return;

  const existingTokens      = await listSupplierTokensByOrg(env.DB, org);
  const existingSupplierIds = new Set(existingTokens.map(t => t.supplierId));

  for (const supplier of config.suppliers) {
    if (existingSupplierIds.has(supplier.id)) continue;

    const token   = generateToken();
    const formUrl = generateFormUrl(env.WORKER_BASE_URL, org, token);

    await insertSupplierToken(env.DB, {
      token,
      org,
      supplierId: supplier.id,
      expiresAt:  tokenExpiresAt(365),
    });

    if (supplier.contact && env.RESEND_API_KEY) {
      await sendOnboardingEmail({
        apiKey:       env.RESEND_API_KEY,
        to:           supplier.contact,
        supplierName: supplier.name,
        orgName:      org,
        formUrl,
      });
    }
  }

  // 重新取得所有 token（含本次新產生），寫回租戶 repo 的 supplier-links.md 供手動遞送
  const allTokens = await listSupplierTokensByOrg(env.DB, org);
  const tokenBySupplierId: Record<string, string> = {};
  for (const t of allTokens) tokenBySupplierId[t.supplierId] = t.token;
  const markdown = buildSupplierLinksMarkdown(env.WORKER_BASE_URL, org, config.suppliers, tokenBySupplierId);
  await upsertSupplierLinks(octokit, org, markdown);
}

export async function handleConfigPush(env: Bindings, payload: GitHubPushPayload): Promise<void> {
  const modifiedFiles = payload.commits.flatMap(c => [...c.added, ...c.modified]);
  if (!modifiedFiles.includes('config.yml')) return;
  await syncConfig(env, payload.repository.owner.login, payload.installation.id);
}
