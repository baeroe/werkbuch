/*
 * Coverage exceptions in the frontend need a reason (plan, global constraints): every `istanbul ignore` in
 * resources/js/**\/*.{ts,tsx} reads `/* istanbul ignore <next|if|else> -- <reason of at least three words> *\/`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '..');
const VALID = /\/\* istanbul ignore (?:next|if|else) -- (?<reason>(?:(?!\*\/).)+?) *\*\//;

/** `<file>:<line>` of every `istanbul ignore` in `code` that is not of the valid form. */
export function unjustifiedIgnores(code, file = 'code') {
  return code.split('\n').flatMap((line, index) => {
    if (!/istanbul\s+ignore/.test(line)) return [];
    const reason = VALID.exec(line)?.groups?.reason ?? '';
    return reason.trim().split(/\s+/).filter(Boolean).length >= 3 ? [] : [`${file}:${index + 1}`];
  });
}

function sources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe('istanbul ignore comments', () => {
  it('detects ignores without the form or without a reason', () => {
    expect(unjustifiedIgnores('/* istanbul ignore next */')).toEqual(['code:1']);
    expect(unjustifiedIgnores('/* istanbul ignore next -- see above */')).toEqual(['code:1']);
    expect(unjustifiedIgnores('// istanbul ignore next -- the browser never gets here')).toEqual(['code:1']);
    expect(unjustifiedIgnores('/* istanbul ignore file -- the browser never gets here */')).toEqual(['code:1']);
    expect(unjustifiedIgnores('/* istanbul ignore start -- the browser never gets here */')).toEqual(['code:1']);
    expect(unjustifiedIgnores('a();\n  /* istanbul ignore if -- the browser never gets here */')).toEqual([]);
    expect(unjustifiedIgnores('/* istanbul ignore else -- jsdom has no layout at all */')).toEqual([]);
    expect(unjustifiedIgnores('/* istanbul ignore next -- the server always sends it */ x();')).toEqual([]);
  });

  it('gives every ignore in resources/js a reason of at least three words', () => {
    const hits = sources(path.join(root, 'resources/js')).flatMap((file) => unjustifiedIgnores(fs.readFileSync(file, 'utf8'), path.relative(root, file)));

    expect(hits).toEqual([]);
  });
});
