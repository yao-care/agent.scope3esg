export interface Bindings {
  DB: D1Database;
  FILES: R2Bucket;
  SUBMISSION_QUEUE: Queue;
  GITHUB_APP_ID: string;
  GITHUB_APP_PRIVATE_KEY: string;
  GITHUB_WEBHOOK_SECRET: string;
  GITHUB_APP_CLIENT_ID: string;
  GITHUB_APP_CLIENT_SECRET: string;
  RESEND_API_KEY: string;
  WORKER_BASE_URL: string;
  SESSION_SECRET: string;
}

export interface Variables {
  rawBody: string;
}

export interface GitHubInstallationPayload {
  action: 'created' | 'deleted' | 'suspend' | 'unsuspend';
  installation: {
    id: number;
    account: {
      login: string;
      type: 'Organization' | 'User';
    };
  };
}

export interface GitHubPushPayload {
  ref: string;
  repository: {
    name: string;
    owner: { login: string };
  };
  commits: Array<{
    added: string[];
    modified: string[];
  }>;
  installation: { id: number };
}

export interface Submission {
  submission_id: string;
  supplier_id: string;
  supplier_name: string;
  scope3_category: number;
  period: string;
  activity_type: string;
  amount: number;
  unit: string;
  evidence_urls: string[];
  submitted_at: string;
  channel: 'form' | 'api' | 'pull';
  emission_factor_id: null;
  calculated_co2e: null;
}

export interface TenantConfig {
  inventory_year: number;
  enabled_categories: number[];
  suppliers: SupplierConfig[];
}

export interface SupplierConfig {
  id: string;
  name: string;
  contact: string;
  pull_api: string | null;
  pull_schedule: string | null;
}

export interface PullJobMessage {
  org: string;
  supplier_id: string;
  api_url: string;
  token: string;
}
