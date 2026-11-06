import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Checks a request from werkbuch: `X-Werkbuch-Signature` must be `sha256=` and the hex HMAC-SHA256 of
 * "<X-Werkbuch-Timestamp>.<body>" with the secret of the webhook, and the timestamp at most 300 seconds away from now
 * (against replays). Pass the body exactly as it arrived (a string or a Buffer), before parsing it as JSON.
 * A missing or malformed header is no valid signature: the function answers false, it never throws.
 *
 * @param {string} secret the secret of the webhook
 * @param {string | undefined} timestamp the header X-Werkbuch-Timestamp (Unix seconds)
 * @param {string | Buffer} body the raw body
 * @param {string | undefined} signatureHeader the header X-Werkbuch-Signature
 * @param {number} [now] Unix seconds, now by default
 * @returns {boolean}
 */
export function verifyWerkbuchSignature(secret, timestamp, body, signatureHeader, now = Math.floor(Date.now() / 1000)) {
  if (typeof timestamp !== 'string' || typeof signatureHeader !== 'string') return false;
  if (!/^\d{1,10}$/.test(timestamp) || Math.abs(now - Number(timestamp)) > 300) return false;

  const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(`${timestamp}.`).update(body).digest('hex')}`);
  const given = Buffer.from(signatureHeader);
  // compared in constant time; timingSafeEqual needs two buffers of the same length
  return given.length === expected.length && timingSafeEqual(given, expected);
}
