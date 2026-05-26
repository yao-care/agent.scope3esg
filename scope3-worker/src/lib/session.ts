// src/lib/session.ts
// 無狀態 HMAC-SHA256 簽章。格式：base64url(JSON).base64url(HMAC)。用於 admin session 與 OAuth state。

function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecodeToString(s: string): string {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return bin;
}

async function hmac(data: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return new Uint8Array(sig);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sign<T>(payload: T, secret: string): Promise<string> {
  const json = JSON.stringify(payload);
  const body = b64urlEncode(new TextEncoder().encode(json));
  const sig = b64urlEncode(await hmac(body, secret));
  return `${body}.${sig}`;
}

async function verify<T>(token: string, secret: string): Promise<T | null> {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = b64urlEncode(await hmac(body, secret));
  if (!timingSafeEqual(sig, expected)) return null;
  try {
    return JSON.parse(b64urlDecodeToString(body)) as T;
  } catch {
    return null;
  }
}

export interface SessionPayload { org: string; user: string; exp: number; }
export interface StatePayload { org: string; nonce: string; }

export async function signSession(payload: SessionPayload, secret: string): Promise<string> {
  return sign(payload, secret);
}
export async function verifySession(token: string, secret: string): Promise<SessionPayload | null> {
  const p = await verify<SessionPayload>(token, secret);
  if (!p) return null;
  if (typeof p.exp !== 'number' || p.exp < Date.now()) return null;
  return p;
}
export async function signState(payload: StatePayload, secret: string): Promise<string> {
  return sign(payload, secret);
}
export async function verifyState(state: string, secret: string): Promise<StatePayload | null> {
  return verify<StatePayload>(state, secret);
}
