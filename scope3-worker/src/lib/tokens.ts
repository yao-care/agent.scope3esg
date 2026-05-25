export function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return 'stok_' + Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export function generateFormUrl(baseUrl: string, org: string, token: string): string {
  return `${baseUrl}/submit/${org}/${token}`;
}

export function tokenExpiresAt(daysFromNow = 365): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString();
}
