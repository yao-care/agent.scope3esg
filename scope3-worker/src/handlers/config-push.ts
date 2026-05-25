import { getInstallationOctokit } from '../github/app';
import { readTenantConfig } from '../github/config';
import { listSupplierTokensByOrg, insertSupplierToken } from '../db/queries';
import { sendOnboardingEmail } from '../email/resend';
import { generateToken, generateFormUrl, tokenExpiresAt } from '../lib/tokens';
import type { Bindings, GitHubPushPayload } from '../types';

export async function handleConfigPush(
  env: Bindings,
  payload: GitHubPushPayload,
): Promise<void> {
  const modifiedFiles = payload.commits.flatMap(c => [...c.added, ...c.modified]);
  if (!modifiedFiles.includes('config.yml')) return;

  const org    = payload.repository.owner.login;
  const instId = payload.installation.id;

  const octokit = await getInstallationOctokit(env, instId);
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
}
