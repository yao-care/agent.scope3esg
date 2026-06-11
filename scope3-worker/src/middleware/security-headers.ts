import { createMiddleware } from 'hono/factory';

/**
 * 安全標頭中介層。
 *
 * 針對 HTML 回應補上一組安全標頭，修補 ZAP 掃描回報的 medium 級弱點
 * （CSP 過鬆、缺乏防點擊劫持/MIME sniffing 防護）。
 *
 * CSP 範圍說明：
 * - 本站所有資源皆自託管（無外部 CDN / 字型 / 樣式表），故 default-src 鎖 'self'。
 * - 頁面使用內嵌 <script> 與內嵌 style，且無 nonce 基礎建設，
 *   因此 script-src / style-src 放行 'unsafe-inline'（最小侵入，避免破壞既有頁面）。
 * - 前端 fetch 皆為同源相對路徑，connect-src 鎖 'self' 即可。
 * - img-src 放行 data: 以容許內嵌圖片。
 * - frame-ancestors 'none' 防止點擊劫持（等同 X-Frame-Options: DENY）。
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

/**
 * 將安全標頭套用到指定的 Response（僅針對 HTML 內容）。
 * 抽成 helper 以利測試與重用。
 */
export function addSecurityHeaders(res: Response): void {
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('text/html')) return;

  res.headers.set('Content-Security-Policy', CSP);
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
}

/** Hono 全域中介層：在下游處理完成後，對 HTML 回應補上安全標頭。 */
export function securityHeaders() {
  return createMiddleware(async (c, next) => {
    await next();
    addSecurityHeaders(c.res);
  });
}
