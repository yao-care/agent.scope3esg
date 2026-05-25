import { Hono } from 'hono';
import type { Bindings, Variables } from '../types';
import { getSupplierToken } from '../db/queries';

const upload = new Hono<{ Bindings: Bindings; Variables: Variables }>();

upload.post('/:org/:token', async (c) => {
  const { org, token } = c.req.param();

  const tokenRow = await getSupplierToken(c.env.DB, token);
  if (!tokenRow || tokenRow.org !== org) {
    return c.json({ error: 'Invalid token' }, 401);
  }

  const formData = await c.req.formData();
  const file = formData.get('file') as File | null;
  if (!file) {
    return c.json({ error: 'No file provided' }, 400);
  }

  if (file.size > 10 * 1024 * 1024) {
    return c.json({ error: 'File too large (max 10MB)' }, 413);
  }

  const ext = file.name.split('.').pop() ?? 'bin';
  const key = `${org}/${tokenRow.supplierId}/${crypto.randomUUID()}.${ext}`;

  await c.env.FILES.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
    customMetadata: {
      originalName: file.name,
      supplierId:   tokenRow.supplierId,
      org,
    },
  });

  const url = `${c.env.WORKER_BASE_URL}/files/${key}`;
  return c.json({ url }, 201);
});

export default upload;
