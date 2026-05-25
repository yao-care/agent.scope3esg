import { Hono } from 'hono';
import type { Bindings, Variables } from '../types';
import { processSubmission } from '../handlers/submission';

const apiSubmit = new Hono<{ Bindings: Bindings; Variables: Variables }>();

apiSubmit.post('/', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing Authorization header' }, 401);
  }
  const token = authHeader.slice(7);
  const org   = c.req.header('X-Scope3-Org') ?? '';
  if (!org) return c.json({ error: 'Missing X-Scope3-Org header' }, 400);

  const body = await c.req.json<{
    scope3_category: number;
    period:          string;
    activity_type:   string;
    amount:          number;
    unit:            string;
    evidence_urls:   string[];
  }>();

  const result = await processSubmission(c.env, {
    org,
    supplierToken: token,
    data:          body,
    channel:       'api',
  });

  if (!result.success) {
    return c.json({ error: result.error }, 400);
  }

  return c.json({ issueNumber: result.issueNumber }, 201);
});

export default apiSubmit;
