import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../../src/index';

describe('GET /assets/app.css', () => {
  it('serves CSS with correct content-type and tokens', async () => {
    const res = await app.request('/assets/app.css', {}, env as any);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/css');
    const body = await res.text();
    expect(body).toContain(':root');
    expect(body).toContain('--primary');
    expect(body).toContain('oklch');
  });
});
