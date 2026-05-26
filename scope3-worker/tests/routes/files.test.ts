import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../../src/index';

describe('GET /files/*', () => {
  beforeAll(async () => {
    await env.FILES.put('acme/abc-123.txt', 'hello evidence', { httpMetadata: { contentType: 'text/plain' } });
  });

  it('returns the stored object', async () => {
    const res = await app.request('/files/acme/abc-123.txt', {}, env as any);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('hello evidence');
  });

  it('returns 404 for missing key', async () => {
    const res = await app.request('/files/acme/nope.txt', {}, env as any);
    expect(res.status).toBe(404);
  });
});
