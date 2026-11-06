import { describe, expect, it } from 'vitest';
import { verifyWerkbuchSignature } from '../docs/snippets/webhooks/verify.mjs';

// the vector of tests/Unit/Domain/Webhooks/SignatureTest.php (Signature::sign)
const secret = 'whsec_test';
const at = 1767225600;
const body = '{"id":"x"}';
const vector = 'sha256=f2a0e9cc79f6a8d5063bc6718561e872509983827740ea4ee5622da1c7e8d2b4';

describe('the Node snippet of the webhook docs', () => {
  it('accepts the signature of the server, as text and as a Buffer, within 300 seconds', () => {
    expect(verifyWerkbuchSignature(secret, String(at), body, vector, at)).toBe(true);
    expect(verifyWerkbuchSignature(secret, String(at), Buffer.from(body), vector, at + 300)).toBe(true);
    expect(verifyWerkbuchSignature(secret, String(at), body, vector, at - 300)).toBe(true);
  });

  it('refuses a changed body, another secret and a time outside the window', () => {
    expect(verifyWerkbuchSignature(secret, String(at), '{"id":"y"}', vector, at)).toBe(false);
    expect(verifyWerkbuchSignature('whsec_other', String(at), body, vector, at)).toBe(false);
    expect(verifyWerkbuchSignature(secret, String(at), body, vector, at + 301)).toBe(false);
    expect(verifyWerkbuchSignature(secret, String(at), body, vector, at - 301)).toBe(false);
  });

  it('answers false for a missing or malformed header, never throws', () => {
    expect(verifyWerkbuchSignature(secret, undefined, body, vector, at)).toBe(false);
    expect(verifyWerkbuchSignature(secret, String(at), body, undefined, at)).toBe(false);
    expect(verifyWerkbuchSignature(secret, `${at}\n`, body, vector, at)).toBe(false);
    expect(verifyWerkbuchSignature(secret, '1e9', body, vector, 1e9)).toBe(false);
    expect(verifyWerkbuchSignature(secret, String(at), body, 'sha256=zz', at)).toBe(false);
    expect(verifyWerkbuchSignature(secret, String(at), body, `${vector}ä`, at)).toBe(false);
  });
});
