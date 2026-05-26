// src/routes/files.ts
import { Hono } from 'hono';
import type { Bindings, Variables } from '../types';

const files = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// 取回供應商佐證檔。key 含斜線（org/.../uuid.ext），用萬用路徑擷取。
// 安全：key 含難猜的 uuid；URL 存於 private repo 的 Issue。未來可加簽章 URL 強化。
files.get('/*', async (c) => {
  const key = decodeURIComponent(c.req.path.replace(/^\/files\//, ''));
  if (!key) return c.text('Not found', 404);
  const obj = await c.env.FILES.get(key);
  if (!obj) return c.text('Not found', 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('Cache-Control', 'private, max-age=300');
  return new Response(obj.body, { headers });
});

export default files;
