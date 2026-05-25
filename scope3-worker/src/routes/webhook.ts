import { Hono } from 'hono';
import type { Bindings, Variables } from '../types';
import { verifyGitHubWebhook } from '../middleware/github-webhook';
import { handleInstallation } from '../handlers/installation';

const webhook = new Hono<{ Bindings: Bindings; Variables: Variables }>();

webhook.post('/', async (c, next) => {
  await verifyGitHubWebhook(c.env.GITHUB_WEBHOOK_SECRET)(c, next);
}, async (c) => {
  const event = c.req.header('x-github-event') ?? '';
  const body = JSON.parse(c.get('rawBody' as never) as string);

  switch (event) {
    case 'installation':
      await handleInstallation(c.env, body);
      break;
    case 'ping':
      break;
  }

  return c.text('ok');
});

export default webhook;
