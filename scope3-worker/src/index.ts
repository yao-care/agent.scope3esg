import { Hono } from 'hono';
import type { Bindings, Variables, PullJobMessage } from './types';
import webhookRoute    from './routes/webhook';
import healthRoute     from './routes/health';
import uploadRoute     from './routes/upload';
import submitRoute     from './routes/submit';
import apiSubmitRoute  from './routes/api-submit';
import configSyncRoute from './routes/config-sync';
import adminRoute      from './routes/admin';
import adminApiRoute   from './routes/admin-api';
import filesRoute      from './routes/files';
import assetsRoute     from './routes/assets';
import dashboardRoute  from './routes/dashboard';
import { handleQueue } from './queue/consumer';
import { handleScheduled } from './handlers/scheduled';
import { securityHeaders } from './middleware/security-headers';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// 安全標頭：對所有 HTML 回應補上 CSP / 防點擊劫持 / nosniff / Referrer-Policy。
app.use('*', securityHeaders());

app.route('/webhook',       webhookRoute);
app.route('/health',        healthRoute);
app.route('/api/v1/upload', uploadRoute);
app.route('/api/v1/submit', apiSubmitRoute);
app.route('/api/v1/config-sync', configSyncRoute);
app.route('/submit',        submitRoute);
app.route('/admin',         adminRoute);
app.route('/api/v1/admin',  adminApiRoute);
app.route('/files',         filesRoute);
app.route('/assets',        assetsRoute);
app.route('/dashboard',     dashboardRoute);

export { app };

export default {
  fetch: app.fetch,
  queue: handleQueue,
  scheduled: (_event: ScheduledController, env: Bindings, ctx: ExecutionContext) => {
    ctx.waitUntil(handleScheduled(env));
  },
} as ExportedHandler<Bindings>;
