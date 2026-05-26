import { describe, it, expect } from 'vitest';
import { signSession, verifySession, signState, verifyState } from '../../src/lib/session';

const SECRET = 'test-session-secret';

describe('session sign/verify', () => {
  it('round-trips a valid session', async () => {
    const token = await signSession({ org: 'acme', user: 'alice', exp: Date.now() + 10000 }, SECRET);
    const payload = await verifySession(token, SECRET);
    expect(payload?.org).toBe('acme');
    expect(payload?.user).toBe('alice');
  });
  it('rejects a tampered token', async () => {
    const token = await signSession({ org: 'acme', user: 'alice', exp: Date.now() + 10000 }, SECRET);
    const tampered = token.slice(0, -2) + (token.endsWith('aa') ? 'bb' : 'aa');
    expect(await verifySession(tampered, SECRET)).toBeNull();
  });
  it('rejects a wrong secret', async () => {
    const token = await signSession({ org: 'acme', user: 'alice', exp: Date.now() + 10000 }, SECRET);
    expect(await verifySession(token, 'other-secret')).toBeNull();
  });
  it('rejects an expired session', async () => {
    const token = await signSession({ org: 'acme', user: 'alice', exp: Date.now() - 1 }, SECRET);
    expect(await verifySession(token, SECRET)).toBeNull();
  });
  it('returns null for malformed input', async () => {
    expect(await verifySession('garbage', SECRET)).toBeNull();
    expect(await verifySession('', SECRET)).toBeNull();
  });
});

describe('state sign/verify', () => {
  it('round-trips org and nonce', async () => {
    const s = await signState({ org: 'acme', nonce: 'n1' }, SECRET);
    const p = await verifyState(s, SECRET);
    expect(p?.org).toBe('acme');
    expect(p?.nonce).toBe('n1');
  });
  it('rejects a tampered state', async () => {
    const s = await signState({ org: 'acme', nonce: 'n1' }, SECRET);
    expect(await verifyState(s + 'x', SECRET)).toBeNull();
  });
});
