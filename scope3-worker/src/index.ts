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
import { handleQueue } from './queue/consumer';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.route('/webhook',       webhookRoute);
app.route('/health',        healthRoute);
app.route('/api/v1/upload', uploadRoute);
app.route('/api/v1/submit', apiSubmitRoute);
app.route('/api/v1/config-sync', configSyncRoute);
app.route('/submit',        submitRoute);
app.route('/admin',         adminRoute);
app.route('/api/v1/admin',  adminApiRoute);
app.route('/files',         filesRoute);

export { app };

export default {
  fetch: app.fetch,
  queue: handleQueue,
} as ExportedHandler<Bindings>;
