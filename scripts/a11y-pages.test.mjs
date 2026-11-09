/*
 * The checks of axe (A441, K15) as a test: e2e/a11y-pages.ts names every page of the app (every file under
 * resources/js/pages) and the states of its screens, and e2e/a11y-exceptions.ts holds what axe still finds, each with a
 * reason and a stable selector. a11y-pages.ts is read as text (it imports the helpers of the e2e, which this test does
 * not load); the exceptions are plain data and imported.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { A11Y_EXCEPTIONS } from '../e2e/a11y-exceptions.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const LIST = read('e2e/a11y-pages.ts');

/** Every file under `dir` (relative to the root), recursively. */
function files(dir) {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const file = `${dir}/${entry.name}`;
    return entry.isDirectory() ? files(file) : [file];
  });
}

/** The values of `<key>: '<value>'` in the list, e.g. every `page: 'Items/Show'`. */
const literals = (key) => [...LIST.matchAll(new RegExp(`\\b${key}: '([^']+)'`, 'g'))].map((match) => match[1]);

/** The names the list gives its entries. */
const names = () => literals('name');

describe('a11y pages', () => {
  it('lists every page of the app', () => {
    const pages = files('resources/js/pages')
      .filter((file) => file.endsWith('.tsx') && !file.includes('.test.'))
      .map((file) => file.replace('resources/js/pages/', '').replace(/\.tsx$/, ''));
    expect(pages.length).toBeGreaterThan(20);
    const listed = new Set(literals('page'));
    expect(pages.filter((page) => !listed.has(page))).toEqual([]);
  });

  it('names no page that does not exist', () => {
    const missing = literals('page').filter((page) => !fs.existsSync(path.join(ROOT, `resources/js/pages/${page}.tsx`)));
    expect(missing).toEqual([]);
  });

  it('gives every entry its own name', () => {
    const all = names();
    expect(all.filter((name, index) => all.indexOf(name) !== index)).toEqual([]);
  });
});

describe('a11y exceptions', () => {
  it('gives every exception a rule and a reason', () => {
    expect(A11Y_EXCEPTIONS.filter((exception) => !/^[a-z0-9-]+$/.test(exception.rule) || exception.reason.trim() === '')).toEqual([]);
  });

  it('names no generated id in a selector', () => {
    expect(A11Y_EXCEPTIONS.filter((exception) => exception.target.trim() === '' || exception.target.includes('#:r') || exception.target.includes('[id^='))).toEqual([]);
  });

  it('knows only Task 16 as an end', () => {
    expect(A11Y_EXCEPTIONS.filter((exception) => exception.until !== undefined && exception.until !== 'Task 16')).toEqual([]);
  });

  it('names only entries of the list', () => {
    const listed = new Set(names());
    expect(A11Y_EXCEPTIONS.flatMap((exception) => exception.pages ?? []).filter((name) => !listed.has(name))).toEqual([]);
  });

  // turned on by Task 16, which fixes what axe found: from then on an exception stays only with a reason of its own
  it.skip('leaves no exception for Task 16', () => {
    expect(A11Y_EXCEPTIONS.filter((exception) => exception.until === 'Task 16')).toEqual([]);
  });
});
