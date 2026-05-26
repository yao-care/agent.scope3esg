// src/routes/assets.ts
import { Hono } from 'hono';
import type { Bindings, Variables } from '../types';
import { APP_CSS } from '../ui/theme.mjs';

const assets = new Hono<{ Bindings: Bindings; Variables: Variables }>();

assets.get('/app.css', (c) => {
  return c.body(APP_CSS, 200, {
    'Content-Type': 'text/css; charset=utf-8',
    'Cache-Control': 'public, max-age=3600',
  });
});

export default assets;
