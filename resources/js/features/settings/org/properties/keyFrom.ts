/*
 * The key a label suggests for a new property (spec 4.7): lower case letters, digits and `_`, a letter first, at most 40
 * characters, as `PropertyKey` on the server wants it. Umlauts are written out, other accents dropped.
 */

const MAX = 40;

/** "Prüfstufe (intern)" becomes "pruefstufe_intern"; a label that starts with a digit gets `p_` in front. */
export function keyFrom(label: string): string {
  const key = label
    .trim()
    .toLowerCase()
    .replaceAll('ä', 'ae')
    .replaceAll('ö', 'oe')
    .replaceAll('ü', 'ue')
    .replaceAll('ß', 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, MAX)
    .replace(/_+$/, '');
  return /^[0-9]/.test(key) ? `p_${key}`.slice(0, MAX).replace(/_+$/, '') : key;
}
