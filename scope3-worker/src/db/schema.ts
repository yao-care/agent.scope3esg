import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const tenants = sqliteTable('tenants', {
  installationId: integer('installation_id').primaryKey(),
  org:            text('org').notNull(),
  repoNodeId:     text('repo_node_id'),
  createdAt:      text('created_at').notNull(),
});

export const supplierTokens = sqliteTable('supplier_tokens', {
  token:       text('token').primaryKey(),
  org:         text('org').notNull(),
  supplierId:  text('supplier_id').notNull(),
  expiresAt:   text('expires_at').notNull(),
  createdAt:   text('created_at').notNull(),
});

export const pullJobs = sqliteTable('pull_jobs', {
  jobId:      text('job_id').primaryKey(),
  org:        text('org').notNull(),
  supplierId: text('supplier_id').notNull(),
  apiUrl:     text('api_url').notNull(),
  schedule:   text('schedule').notNull(),
  lastRunAt:  text('last_run_at'),
  // 供應商自己的 API 憑證（呼叫其 ESG API 的 Bearer），與 supplier_tokens.token 不同
  apiToken:   text('api_token'),
});

export const auditLog = sqliteTable('audit_log', {
  id:        text('id').primaryKey(),
  org:       text('org').notNull(),
  action:    text('action').notNull(),
  actor:     text('actor').notNull(),
  target:    text('target').notNull(),
  createdAt: text('created_at').notNull(),
});
