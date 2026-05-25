// src/types.ts

export interface Bindings {
  DB: D1Database;
  GITHUB_APP_ID: string;
  GITHUB_APP_PRIVATE_KEY: string;
  GITHUB_WEBHOOK_SECRET: string;
  GITHUB_APP_CLIENT_ID: string;
  GITHUB_APP_CLIENT_SECRET: string;
  RESEND_API_KEY: string;
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
