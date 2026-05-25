import { createMiddleware } from 'hono/factory';

export function verifyGitHubWebhook(secret: string) {
  return createMiddleware(async (c, next) => {
    const signature = c.req.header('x-hub-signature-256');
    if (!signature || !signature.startsWith('sha256=')) {
      return c.text('Missing signature', 401);
    }

    const body = await c.req.text();
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );

    const hexStr = signature.slice(7);
    if (hexStr.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hexStr)) {
      return c.text('Invalid signature', 401);
    }

    const sigBytes = Uint8Array.from(
      hexStr.match(/.{2}/g)!.map(h => parseInt(h, 16)),
    );

    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      sigBytes,
      new TextEncoder().encode(body),
    );

    if (!valid) return c.text('Invalid signature', 401);

    c.set('rawBody' as never, body);
    await next();
  });
}
