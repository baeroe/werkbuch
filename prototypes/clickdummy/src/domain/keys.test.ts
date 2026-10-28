import { describe, expect, it } from 'vitest';
import { parseKey } from './keys';

describe('parseKey', () => {
  it('reads a key regardless of case and surrounding space', () => {
    expect(parseKey(' web-123 ')).toEqual({ identifier: 'WEB', number: 123 });
  });

  it('rejects a key without a dash', () => {
    expect(parseKey('WEB123')).toBeNull();
  });

  it('rejects an identifier that is too short', () => {
    expect(parseKey('W-1')).toBeNull();
  });

  it('accepts identifiers of 2 to 10 characters and digits after the first letter', () => {
    expect(parseKey('ab-1')).toEqual({ identifier: 'AB', number: 1 });
    expect(parseKey('web2-7')).toEqual({ identifier: 'WEB2', number: 7 });
    expect(parseKey('ABCDEFGHIJ-5')).toEqual({ identifier: 'ABCDEFGHIJ', number: 5 });
    expect(parseKey('ABCDEFGHIJK-5')).toBeNull();
  });

  it('rejects an identifier that starts with a digit or contains other characters', () => {
    expect(parseKey('2WEB-1')).toBeNull();
    expect(parseKey('WE_B-1')).toBeNull();
    expect(parseKey('ÄB-1')).toBeNull();
  });

  it('rejects numbers that are not positive whole numbers', () => {
    expect(parseKey('WEB-0')).toBeNull();
    expect(parseKey('WEB--1')).toBeNull();
    expect(parseKey('WEB-1.5')).toBeNull();
    expect(parseKey('WEB-12x')).toBeNull();
    expect(parseKey('WEB-')).toBeNull();
    expect(parseKey('WEB-99999999999999999999')).toBeNull();
  });

  it('rejects text around the key and empty input', () => {
    expect(parseKey('see WEB-1')).toBeNull();
    expect(parseKey('')).toBeNull();
    expect(parseKey('   ')).toBeNull();
  });
});
