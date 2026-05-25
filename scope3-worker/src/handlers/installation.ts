import { getInstallationOctokit } from '../github/app';
import { createTenantRepo } from '../github/repo';
import { insertTenant } from '../db/queries';
import type { Bindings, GitHubInstallationPayload } from '../types';

export async function handleInstallation(
  env: Bindings,
  payload: GitHubInstallationPayload,
): Promise<void> {
  if (payload.action !== 'created') return;

  const { id: installationId, account } = payload.installation;
  const org = account.login;

  const octokit = await getInstallationOctokit(env, installationId);
  const repoNodeId = await createTenantRepo(octokit, org);

  await insertTenant(env.DB, { installationId, org, repoNodeId });
}
