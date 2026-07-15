import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../../src/index';

// workers.dev 預設由 Cloudflare 平台層回 robots.txt（content-signals 樣板），
// 不進 Worker，因此拿不到安全標頭（2026-07-15 ZAP 報 nosniff 缺失即此）。
// Worker 自己提供 /robots.txt 就能蓋掉平台預設，順帶讓它走 securityHeaders。
describe('GET /robots.txt', () => {
  it('disallows all crawlers because the whole site is gated', async () => {
    const res = await app.request('/robots.txt', {}, env as any);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('User-agent: *');
    expect(body).toContain('Disallow: /');
  });

  it('is served as plain text', async () => {
    const res = await app.request('/robots.txt', {}, env as any);
    expect(res.headers.get('content-type')).toContain('text/plain');
  });

  // 這是這個路由存在的主因：讓 robots.txt 進 Worker 以取得安全標頭。
  it('carries the security headers that the platform default lacked', async () => {
    const res = await app.request('/robots.txt', {}, env as any);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Strict-Transport-Security')).toContain('max-age=63072000');
  });
});
