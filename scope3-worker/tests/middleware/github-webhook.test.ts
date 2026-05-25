import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { verifyGitHubWebhook } from '../../src/middleware/github-webhook';
import { Bindings, Variables } from '../../src/types';

function makeApp(secret: string) {
  const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
  app.post('/webhook', verifyGitHubWebhook(secret), (c) => c.text('ok'));
  return app;
}

async function sign(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return 'sha256=' + Array.from(new Uint8Array(mac))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

describe('verifyGitHubWebhook', () => {
  it('returns 401 when signature header is missing', async () => {
    const app = makeApp('secret');
    const res = await app.request('/webhook', { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
  });

  it('returns 401 when signature is wrong', async () => {
    const app = makeApp('secret');
    const res = await app.request('/webhook', {
      method: 'POST',
      body: '{}',
      headers: { 'x-hub-signature-256': 'sha256=badhash' },
    });
    expect(res.status).toBe(401);
  });

  it('passes when signature is correct', async () => {
    const body = '{"action":"created"}';
    const sig = await sign(body, 'mysecret');
    const app = makeApp('mysecret');
    const res = await app.request('/webhook', {
      method: 'POST',
      body,
      headers: { 'x-hub-signature-256': sig },
    });
    expect(res.status).toBe(200);
  });
});
