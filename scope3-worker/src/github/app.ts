import { App } from '@octokit/app';
import { Bindings } from '../types';

export function createGitHubApp(env: Bindings): App {
  return new App({
    appId: env.GITHUB_APP_ID,
    privateKey: env.GITHUB_APP_PRIVATE_KEY,
    webhooks: { secret: env.GITHUB_WEBHOOK_SECRET },
  });
}

export async function getInstallationOctokit(
  env: Bindings,
  installationId: number
) {
  return createGitHubApp(env).getInstallationOctokit(installationId);
}
