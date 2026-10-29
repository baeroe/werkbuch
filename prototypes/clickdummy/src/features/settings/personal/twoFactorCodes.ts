/*
 * Two-factor authentication, the parts that are plain functions (spec 4.2: TOTP with an authenticator app, plus
 * recovery codes). The prototype has no server behind this: the key is random but not a real secret, and any six
 * digits count as the right code.
 */

export const RECOVERY_CODE_COUNT = 10;

/** Without the look-alikes i, l, o, 0 and 1: recovery codes are read off a screen or a printout. */
const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** `count` characters drawn from `alphabet`. */
function randomText(alphabet: string, count: number): string {
  const values = new Uint32Array(count);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') crypto.getRandomValues(values);
  else values.forEach((_, index) => (values[index] = Math.floor(Math.random() * 2 ** 32)));
  return Array.from(values, (value) => alphabet[value % alphabet.length]).join('');
}

/** Ten different codes such as `k3m9x-w4tq2`. */
export function generateRecoveryCodes(): string[] {
  const codes = new Set<string>();
  while (codes.size < RECOVERY_CODE_COUNT) {
    const code = randomText(RECOVERY_ALPHABET, 10);
    codes.add(`${code.slice(0, 5)}-${code.slice(5)}`);
  }
  return [...codes];
}

/** The key an authenticator app takes when the code cannot be scanned: 16 characters of base32 in groups of four. */
export function generateSetupKey(): string {
  return randomText(BASE32_ALPHABET, 16).replace(/(.{4})(?=.)/g, '$1 ');
}

/** Whether a typed code has the shape of a TOTP code: six digits, spaces allowed (apps show `123 456`). */
export function isAuthCode(input: string): boolean {
  return /^\d{6}$/.test(input.replace(/\s+/g, ''));
}
