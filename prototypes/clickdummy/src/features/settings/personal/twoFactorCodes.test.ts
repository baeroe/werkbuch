import { describe, expect, it } from 'vitest';
import { qrModules } from './qr';
import { generateRecoveryCodes, generateSetupKey, isAuthCode, RECOVERY_CODE_COUNT } from './twoFactorCodes';

describe('generateRecoveryCodes', () => {
  it('gives ten different codes of two groups of five characters, without look-alikes', () => {
    const codes = generateRecoveryCodes();

    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(RECOVERY_CODE_COUNT).toBe(10);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
    for (const code of codes) expect(code).toMatch(/^[a-hjkmnp-z2-9]{5}-[a-hjkmnp-z2-9]{5}$/);
  });

  it('gives a new set every time', () => {
    expect(generateRecoveryCodes()).not.toEqual(generateRecoveryCodes());
  });
});

describe('generateSetupKey', () => {
  it('is 16 characters of base32 in four groups, the way authenticator apps show a key', () => {
    expect(generateSetupKey()).toMatch(/^([A-Z2-7]{4} ){3}[A-Z2-7]{4}$/);
  });
});

describe('isAuthCode', () => {
  it.each(['123456', '000000', '123 456', ' 123456 '])('takes %j: any six digits count in the demo', (input) => {
    expect(isAuthCode(input)).toBe(true);
  });

  it.each(['', '12345', '1234567', '12345a', '12-456', 'abcdef'])('refuses %j', (input) => {
    expect(isAuthCode(input)).toBe(false);
  });
});

describe('qrModules', () => {
  const modules = qrModules('ABCD EFGH IJKL MNOP');

  it('is a square grid of 29 modules', () => {
    expect(modules).toHaveLength(29);
    for (const row of modules) expect(row).toHaveLength(29);
  });

  it('draws the three finder squares in the corners: a dark ring, a light ring and a dark centre', () => {
    const finder = (top: number, left: number) => [modules[top][left], modules[top + 1][left + 1], modules[top + 3][left + 3], modules[top + 6][left + 6]];
    const last = modules.length - 7;
    for (const corner of [finder(0, 0), finder(0, last), finder(last, 0)]) expect(corner).toEqual([true, false, true, true]);
  });

  it('alternates dark and light between the finders, like the timing line of a QR code', () => {
    expect(modules[6].slice(8, 21).map(Number)).toEqual([1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1]);
  });

  it('is the same for the same key and different for another', () => {
    expect(qrModules('ABCD EFGH IJKL MNOP')).toEqual(modules);
    expect(qrModules('WXYZ 2345 6723 ABCD')).not.toEqual(modules);
  });
});
