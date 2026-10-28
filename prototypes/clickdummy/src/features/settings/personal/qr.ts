/*
 * The QR dummy of the two-factor setup: a grid of modules that looks like a QR code (three finder squares, the timing
 * lines, noise between) but encodes nothing. The same key always gives the same picture. No library: the prototype has
 * no real secret, and a scannable code would suggest there is one.
 */

/** A seed from text (xmur3's first step). */
function hashOf(text: string): number {
  let hash = 1779033703 ^ text.length;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 3432918353);
    hash = (hash << 13) | (hash >>> 19);
  }
  return hash >>> 0;
}

/** A small seeded generator (mulberry32): numbers in [0, 1). */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** `size` × `size` modules, `true` is dark. */
export function qrModules(seed: string, size = 29): boolean[][] {
  const random = seeded(hashOf(seed));
  const dark = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  const fixed = Array.from({ length: size }, () => Array<boolean>(size).fill(false));

  // finder squares with their light separator: a dark ring, a light ring, a dark 3 × 3 centre
  for (const [top, left] of [
    [0, 0],
    [0, size - 7],
    [size - 7, 0],
  ]) {
    for (let row = -1; row <= 7; row += 1) {
      for (let column = -1; column <= 7; column += 1) {
        const y = top + row;
        const x = left + column;
        if (y < 0 || y >= size || x < 0 || x >= size) continue;
        fixed[y][x] = true;
        const inside = row >= 0 && row <= 6 && column >= 0 && column <= 6;
        const ring = row === 0 || row === 6 || column === 0 || column === 6;
        const centre = row >= 2 && row <= 4 && column >= 2 && column <= 4;
        dark[y][x] = inside && (ring || centre);
      }
    }
  }

  // timing lines between the finders
  for (let index = 8; index < size - 8; index += 1) {
    dark[6][index] = index % 2 === 0;
    dark[index][6] = index % 2 === 0;
    fixed[6][index] = true;
    fixed[index][6] = true;
  }

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!fixed[y][x]) dark[y][x] = random() < 0.5;
    }
  }
  return dark;
}
