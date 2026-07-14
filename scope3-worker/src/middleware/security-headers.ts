import { createMiddleware } from 'hono/factory';

/**
 * 安全標頭中介層。修補 ZAP 掃描（2026-07-14）回報的缺標頭問題。
 *
 * 標頭分兩類，因為套用範圍不同：
 *
 * 1. ALWAYS — 每個回應都套，含 robots.txt / sitemap.xml / app.css / JSON API。
 *    ZAP 是對 /robots.txt 報 X-Content-Type-Options 缺失、對 5 個路由報 HSTS 缺失，
 *    所以這些標頭若只套 HTML 就修不掉（robots.txt 不是 text/html）。
 *
 * 2. HTML_ONLY — 只對 HTML document 有意義的標頭；套在 CSS/JSON 上沒有作用。
 *
 * CSP 範圍說明：
 * - 本站所有資源皆自託管（無外部 CDN / 字型 / 樣式表），故 default-src 鎖 'self'。
 * - 頁面使用內嵌 <script> 與內嵌 style，且無 nonce 基礎建設，
 *   因此 script-src / style-src 放行 'unsafe-inline'（最小侵入，避免破壞既有頁面）。
 *   相對地 default-src 'self' 仍擋掉外部來源注入。
 * - 前端 fetch 皆為同源相對路徑，connect-src 鎖 'self' 即可。
 * - img-src 放行 data: 以容許內嵌圖片。
 * - frame-ancestors 'none' 防止點擊劫持（等同 X-Frame-Options: DENY，兩者並存以相容舊瀏覽器）。
 *
 * COEP require-corp 之所以安全：本站無任何跨源子資源，同源資源不需 CORP 即可載入。
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/** 每個回應都要有的標頭（傳輸層與資源層，與內容型別無關）。 */
const ALWAYS: Record<string, string> = {
  // Worker 只走 HTTPS，兩年 + preload。
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
};

/** 只對 HTML document 有意義的標頭。 */
const HTML_ONLY: Record<string, string> = {
  'Content-Security-Policy': CSP,
  'X-Frame-Options': 'DENY',
};

/**
 * 將安全標頭套用到指定的 Response。
 * 抽成 helper 以利測試與重用。
 */
export function addSecurityHeaders(res: Response): void {
  for (const [name, value] of Object.entries(ALWAYS)) {
    res.headers.set(name, value);
  }

  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('text/html')) return;

  for (const [name, value] of Object.entries(HTML_ONLY)) {
    res.headers.set(name, value);
  }
}

/** Hono 全域中介層：在下游處理完成後，對回應補上安全標頭。 */
export function securityHeaders() {
  return createMiddleware(async (c, next) => {
    await next();
    addSecurityHeaders(c.res);
  });
}
