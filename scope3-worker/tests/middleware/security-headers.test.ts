import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { securityHeaders } from '../../src/middleware/security-headers';

function makeApp() {
  const app = new Hono();
  app.use('*', securityHeaders());
  app.get('/page', (c) => c.html('<h1>hi</h1>'));
  app.get('/robots.txt', (c) => c.text('User-agent: *'));
  app.get('/boom', (c) => c.text('nope', 404));
  return app;
}

describe('securityHeaders', () => {
  it('sets HSTS with a two-year max-age and subdomains', async () => {
    const res = await makeApp().request('/page');
    expect(res.headers.get('Strict-Transport-Security')).toBe('max-age=63072000; includeSubDomains; preload');
  });

  it('sets the three cross-origin isolation headers', async () => {
    const res = await makeApp().request('/page');
    expect(res.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
    expect(res.headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin');
    expect(res.headers.get('Cross-Origin-Embedder-Policy')).toBe('require-corp');
  });

  it('disables camera, microphone and geolocation via Permissions-Policy', async () => {
    const res = await makeApp().request('/page');
    expect(res.headers.get('Permissions-Policy')).toBe('camera=(), microphone=(), geolocation=(), payment=()');
  });

  it('sets Referrer-Policy', async () => {
    const res = await makeApp().request('/page');
    expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  });

  it('sets a CSP that confines resources to same-origin and blocks framing', async () => {
    const res = await makeApp().request('/page');
    const csp = res.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
  });

  it('sets X-Frame-Options alongside CSP for older browsers', async () => {
    const res = await makeApp().request('/page');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
  });

  // 頁面產生器（admin/submit/dashboard）目前都用 inline <script> 與 style=""。
  // CSP 若不放行 inline，全站頁面會立刻壞掉；改 nonce 需重寫 6 個產生器，不在本次範圍。
  it('allows inline script and style because the pages rely on them', async () => {
    const res = await makeApp().request('/page');
    const csp = res.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
  });

  // ZAP 是對 /robots.txt 報 X-Content-Type-Options 缺失。若標頭只套 text/html
  // 就修不掉這條，所以這裡明確釘住非 HTML 回應也要有 nosniff 與 HSTS。
  it('sets nosniff and HSTS on non-HTML responses such as robots.txt', async () => {
    const res = await makeApp().request('/robots.txt');
    expect(res.headers.get('content-type')).not.toContain('text/html');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Strict-Transport-Security')).toContain('max-age=63072000');
  });

  // CSP / X-Frame-Options 對非 document 回應沒有意義，不必送。
  it('does not set CSP on non-HTML responses', async () => {
    const res = await makeApp().request('/robots.txt');
    expect(res.headers.get('Content-Security-Policy')).toBeNull();
    expect(res.headers.get('X-Frame-Options')).toBeNull();
  });

  it('leaves the response body and status untouched', async () => {
    const res = await makeApp().request('/page');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('<h1>hi</h1>');
  });

  it('still sets headers on error responses', async () => {
    const res = await makeApp().request('/boom');
    expect(res.status).toBe(404);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
});
