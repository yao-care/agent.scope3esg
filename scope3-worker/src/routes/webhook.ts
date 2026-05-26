import { Hono } from 'hono';
import type { Bindings, Variables } from '../types';
import { verifyGitHubWebhook } from '../middleware/github-webhook';
import { handleInstallation } from '../handlers/installation';
import { handleConfigPush } from '../handlers/config-push';

const webhook = new Hono<{ Bindings: Bindings; Variables: Variables }>();

webhook.post('/', async (c, next) => {
  await verifyGitHubWebhook(c.env.GITHUB_WEBHOOK_SECRET)(c, next);
}, async (c) => {
  const event = c.req.header('x-github-event') ?? '';
  const body = JSON.parse(c.get('rawBody' as never) as string);

  try {
    switch (event) {
      case 'installation':
        await handleInstallation(c.env, body);
        break;
      case 'push':
        await handleConfigPush(c.env, body);
        break;
      case 'ping':
        break;
    }
  } catch (e) {
    console.error(`[webhook] ${event} handler failed:`, e);
    return c.text('Internal Server Error', 500);
  }

  return c.text('ok');
});

export default webhook;
