// src/admin/page.ts
export function adminPageHtml(org: string): string {
  return `<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="UTF-8"><title>Scope 3 管理</title></head>
<body><h1>Scope 3 管理 — ${org}</h1><p>載入中…</p></body></html>`;
}
