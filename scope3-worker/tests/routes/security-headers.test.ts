import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../../src/index';

// 驗證 securityHeaders 確實掛在 app 上（不只是 middleware 單元本身正確）。
// 掃描器打的是真實路由，所以這裡也打真實路由。
describe('security headers on the real app', () => {
  it('sends HSTS and nosniff on /health', async () => {
    const res = await app.request('/health', {}, env as any);
    expect(res.headers.get('Strict-Transport-Security')).toContain('max-age=63072000');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  // CSS 不是 document，不需要 CSP；但仍須有傳輸層與資源層標頭。
  it('sends HSTS and CORP on /assets/app.css', async () => {
    const res = await app.request('/assets/app.css', {}, env as any);
    expect(res.headers.get('Strict-Transport-Security')).toContain('max-age=63072000');
    expect(res.headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin');
  });

  it('sends the cross-origin headers on a redirecting admin page', async () => {
    const res = await app.request('/admin/nonexistent-org', {}, env as any);
    expect(res.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
    expect(res.headers.get('Permissions-Policy')).toContain('camera=()');
  });
});
