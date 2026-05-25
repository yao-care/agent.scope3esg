import { Hono } from 'hono';
import type { Bindings, Variables } from './types';
import webhookRoute from './routes/webhook';
import healthRoute from './routes/health';
import uploadRoute from './routes/upload';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.route('/webhook', webhookRoute);
app.route('/health',  healthRoute);
app.route('/api/v1/upload', uploadRoute);

export default app;
