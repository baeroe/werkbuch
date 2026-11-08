/*
 * Success criterion 6 (every flow without a mouse, Playwright checks it) as a test (A442, K16): e2e/keyboard-flows.ts maps
 * every id of the shortcut catalog and every key of a widget (`<group>:<label>`, the last parts of their translation keys,
 * `palette:move` for `shortcuts.widget.group.palette` and `shortcuts.widget.palette.move`) to a Playwright test, and this
 * file keeps that map complete and honest: the spec exists, the title stands there literally, the body of that test (from
 * its call to the matching bracket) uses no mouse, and a test that skips a project proves nothing there.
 *
 * The catalog and the widgets are read as text: keyboard-flows.ts lives under e2e/ and imports nothing of the app (its
 * type check knows no `@/` alias), so only this test knows both sides.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GAPS, MOUSE_ALLOWED, PROJECT_GAPS, SHORTCUT_TESTS } from '../e2e/keyboard-flows.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

/** What a keyboard-only test may not do: pointer calls of Playwright and synthetic pointer events. */
const MOUSE = /\.(?:click|dblclick|hover|dragTo|tap|setChecked|uncheck)\s*\(|\.mouse\b|\.touchscreen\b|dispatchEvent\(\s*new\s+(?:Mouse|Pointer|Touch|Drag)Event\b|dispatchEvent\(\s*['"](?:click|dblclick|mouse|pointer|touch|drag)/;

/** The ids of `SHORTCUTS` in catalog.ts. */
function catalogIds(source = read('resources/js/lib/shortcuts/catalog.ts')) {
  const block = source.slice(source.indexOf('export const SHORTCUTS = {'));
  return [...block.matchAll(/^ {2}'([a-z0-9_.]+)': \{/gm)].map((match) => match[1]);
}

/** Every key of a widget as `<group>:<label>`, once per label of a group, in the order of widgets.ts. */
function widgetKeys(source = read('resources/js/lib/shortcuts/widgets.ts')) {
  const keys = [];
  for (const part of source.split(/\bgroup: '/).slice(1)) {
    const group = part.slice(0, part.indexOf("'"));
    const name = group.replace(/^shortcuts\.widget\.group\./, '');
    if (name === group) throw new Error(`widgets.ts: a group outside shortcuts.widget.group: ${group}`);
    for (const [, label] of part.matchAll(/\blabel: '([^']+)'/g)) {
      const prefix = `shortcuts.widget.${name}.`;
      if (!label.startsWith(prefix)) throw new Error(`widgets.ts: ${label} is no label of the group ${name}`);
      const key = `${name}:${label.slice(prefix.length)}`;
      if (!keys.includes(key)) keys.push(key);
    }
  }
  return keys;
}

/** The Playwright projects that run the specs, with whether their viewport is a phone (`isPhone` in e2e/helpers.ts). */
function projects(source = read('e2e/playwright.config.ts')) {
  return [...source.matchAll(/\['([a-z-]+)',\s*(desktop|phone),/g)].map(([, name, device]) => ({ name, phone: device === 'phone' }));
}

/**
 * The source with every string, comment and regular expression blanked to spaces (same length, same lines, quotes kept),
 * so brackets and calls are found in code only. The expressions inside `${…}` of a template stay code.
 */
function mask(source) {
  const out = source.split('');
  const blank = (from, to) => {
    for (let i = from; i < to; i++) if (out[i] !== '\n') out[i] = ' ';
  };
  // a stack of open templates: each holds the depth of braces of the code inside its current `${`
  const templates = [];
  let last = ''; // the last significant code character, to tell a regular expression from a division
  let i = 0;
  const templateText = () => {
    // inside a template literal, after its backtick or after the `}` of an expression
    const start = i;
    while (i < source.length) {
      if (source[i] === '\\') i += 2;
      else if (source[i] === '`') {
        blank(start, i);
        i++;
        templates.pop();
        last = ')';
        return;
      } else if (source[i] === '$' && source[i + 1] === '{') {
        blank(start, i);
        i += 2;
        templates[templates.length - 1] = 0;
        last = '{';
        return;
      } else i++;
    }
    blank(start, i);
  };
  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1];
    if (char === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      blank(i, end === -1 ? source.length : end);
      i = end === -1 ? source.length : end;
    } else if (char === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      blank(i, end === -1 ? source.length : end + 2);
      i = end === -1 ? source.length : end + 2;
    } else if (char === "'" || char === '"') {
      let j = i + 1;
      while (j < source.length && source[j] !== char && source[j] !== '\n') j += source[j] === '\\' ? 2 : 1;
      blank(i + 1, j);
      i = j + 1;
      last = ')';
    } else if (char === '`') {
      i++;
      templates.push(null);
      templateText();
    } else if (char === '/' && (last === '' || '(,=:[!&|?{};+-*%<>~^'.includes(last) || /\b(?:return|typeof|case|of|in)\s*$/.test(source.slice(Math.max(0, i - 8), i)))) {
      let j = i + 1;
      let inClass = false;
      while (j < source.length && source[j] !== '\n') {
        if (source[j] === '\\') j++;
        else if (source[j] === '[') inClass = true;
        else if (source[j] === ']') inClass = false;
        else if (source[j] === '/' && !inClass) break;
        j++;
      }
      blank(i + 1, j);
      i = j + 1;
      while (/[a-z]/i.test(source[i] ?? '')) i++;
      last = ')';
    } else {
      if (templates.length > 0 && templates[templates.length - 1] !== null) {
        if (char === '{') templates[templates.length - 1]++;
        else if (char === '}') {
          if (templates[templates.length - 1] === 0) {
            i++;
            templates[templates.length - 1] = null;
            templateText();
            continue;
          }
          templates[templates.length - 1]--;
        }
      }
      if (!/\s/.test(char)) last = char;
      i++;
    }
  }
  return out.join('');
}

/** The index of the bracket that closes the one at `open`, in masked source. */
function closing(masked, open) {
  const pairs = { '(': ')', '[': ']', '{': '}' };
  const stack = [];
  for (let i = open; i < masked.length; i++) {
    if (pairs[masked[i]]) stack.push(pairs[masked[i]]);
    else if (masked[i] === ')' || masked[i] === ']' || masked[i] === '}') {
      if (stack.pop() !== masked[i]) throw new Error(`unbalanced ${masked[i]} at ${i}`);
      if (stack.length === 0) return i;
    }
  }
  throw new Error(`no closing bracket for ${open}`);
}

/** The value of a plain string literal at `at` (quotes or a template without `${`), else null. */
function literal(source, at) {
  const quote = source[at];
  if (quote !== "'" && quote !== '"' && quote !== '`') return null;
  let value = '';
  for (let i = at + 1; i < source.length; i++) {
    if (source[i] === quote) return value;
    if (quote === '`' && source[i] === '$' && source[i + 1] === '{') return null;
    if (source[i] === '\\') {
      i++;
      value += { n: '\n', t: '\t' }[source[i]] ?? source[i];
    } else value += source[i];
  }
  return null;
}

/** Every `test('…', …)` and `it('…', …)` of a spec: its title and its call from `test` to the matching bracket. */
function testCalls(source, masked = mask(source)) {
  const calls = [];
  for (const match of masked.matchAll(/(?<![\w.$])(?:test|it)\s*\(/g)) {
    const open = match.index + match[0].length - 1;
    let at = open + 1;
    while (/\s/.test(source[at])) at++;
    const title = literal(source, at);
    if (title === null) continue;
    calls.push({ title, start: match.index, end: closing(masked, open) + 1 });
  }
  return calls;
}

/**
 * The names of functions of a spec that use a mouse, also through another such function of the same file. A test that
 * calls one uses the mouse as much as one that clicks itself.
 */
function mouseHelpers(source, masked = mask(source)) {
  const bodies = new Map();
  for (const match of masked.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(|\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:\([^()]*(?:\([^()]*\)[^()]*)*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>/g)) {
    const name = match[1] ?? match[2];
    let at = match.index + match[0].length;
    if (match[1]) at = closing(masked, at - 1) + 1;
    while (at < masked.length && masked[at] !== '{' && masked[at] !== '\n' && masked[at] !== ';') at++;
    const end = masked[at] === '{' ? closing(masked, at) + 1 : at;
    bodies.set(name, masked.slice(match.index, end));
  }
  const users = new Set([...bodies].filter(([, body]) => MOUSE.test(body)).map(([name]) => name));
  for (let grew = true; grew; ) {
    grew = false;
    for (const [name, body] of bodies) {
      if (!users.has(name) && [...users].some((user) => new RegExp(`(?<![\\w.$])${escape(user)}\\s*\\(`).test(body))) {
        users.add(name);
        grew = true;
      }
    }
  }
  return users;
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const specs = new Map();
/** A spec of e2e/tests read once: source, masked source, its tests and its mouse helpers. */
function spec(file) {
  if (!specs.has(file)) {
    const source = read(path.join('e2e/tests', file));
    const masked = mask(source);
    const tests = testCalls(source, masked);
    // a skip outside a test (in a describe, a hook) would hold for tests this check reads as running everywhere
    for (const skip of masked.matchAll(/(?<![\w$])test\.skip\s*\(/g)) {
      if (!tests.some((call) => call.start < skip.index && skip.index < call.end)) throw new Error(`${file}: test.skip outside a test, which this check does not read`);
    }
    specs.set(file, { source, masked, tests, helpers: mouseHelpers(source, masked) });
  }
  return specs.get(file);
}

const ALL = projects();
const proofsOf = (entry) => (Array.isArray(entry) ? entry : [entry]);

/**
 * Where a proof holds: the projects its test runs in (a `test.skip(isPhone(page), …)` leaves out the phones, one with
 * `!isPhone` the desktops), narrowed to `projects` if the entry names them. Throws what is wrong with the proof.
 */
function provenIn(proof, allowances = MOUSE_ALLOWED) {
  const where = `${proof.file} › ${proof.test}`;
  if (!fs.existsSync(path.join(ROOT, 'e2e/tests', proof.file))) throw new Error(`${proof.file}: no such spec under e2e/tests`);
  const { source, masked, tests, helpers } = spec(proof.file);
  const found = tests.filter((call) => call.title === proof.test);
  if (found.length === 0) throw new Error(`${where}: no test('…') with this title`);
  if (found.length > 1) throw new Error(`${where}: the title stands ${found.length} times`);
  const { start, end } = found[0];

  let body = masked.slice(start, end);
  for (const allowed of allowances.filter((entry) => entry.file === proof.file && entry.test === proof.test)) {
    const at = source.slice(start, end).indexOf(allowed.call);
    if (at === -1) throw new Error(`${where}: MOUSE_ALLOWED names a call the test does not make: ${allowed.call}`);
    body = body.slice(0, at) + ' '.repeat(allowed.call.length) + body.slice(at + allowed.call.length);
  }
  const mouse = body.match(MOUSE);
  if (mouse) throw new Error(`${where}: uses the mouse (${mouse[0].trim()}) at line ${source.slice(0, start + body.indexOf(mouse[0])).split('\n').length}`);
  for (const helper of helpers) {
    if (new RegExp(`(?<![\\w.$])${escape(helper)}\\s*\\(`).test(body)) throw new Error(`${where}: calls ${helper}(), which uses the mouse`);
  }

  let runs = ALL.map((project) => project.name);
  for (const skip of body.matchAll(/(?<![\w$])test\.skip\s*\(/g)) {
    const open = skip.index + skip[0].length - 1;
    const condition = source.slice(start + open + 1, start + closing(body, open)).split(',')[0].replace(/\s+/g, '');
    if (condition === 'isPhone(page)') runs = runs.filter((name) => !ALL.find((project) => project.name === name).phone);
    else if (condition === '!isPhone(page)') runs = runs.filter((name) => ALL.find((project) => project.name === name).phone);
    else throw new Error(`${where}: test.skip(${condition}, …) is a condition this test does not read; name the projects`);
  }
  if (proof.projects === undefined) return runs;
  for (const name of proof.projects) {
    if (!ALL.some((project) => project.name === name)) throw new Error(`${where}: no Playwright project ${name}`);
    if (!runs.includes(name)) throw new Error(`${where}: claims ${name}, where the test skips`);
  }
  return proof.projects;
}

/** What is wrong with the proofs of one key, across all projects (none: an empty list). */
function problemsOf(key, entry) {
  const problems = [];
  const covered = new Set();
  for (const proof of proofsOf(entry)) {
    try {
      for (const name of provenIn(proof)) covered.add(name);
    } catch (error) {
      problems.push(`${key}: ${error.message}`);
    }
  }
  const excused = PROJECT_GAPS.filter((gap) => gap.key === key).flatMap((gap) => gap.projects);
  for (const name of excused) if (covered.has(name)) problems.push(`${key}: PROJECT_GAPS excuses ${name}, which a proof covers`);
  for (const { name } of ALL) if (!covered.has(name) && !excused.includes(name)) problems.push(`${key}: nothing proves it in ${name} (a proof, or PROJECT_GAPS with a reason)`);
  return problems;
}

describe('keyboard manifest', () => {
  const keys = [...catalogIds(), ...widgetKeys()];

  it('reads the catalog, the widgets and the projects', () => {
    // every entry of each file, once: the catalog has one `keys:` per id, the widgets one label per key
    expect(catalogIds()).toHaveLength(read('resources/js/lib/shortcuts/catalog.ts').match(/\bkeys: '/g).length);
    expect(catalogIds()).toContain('shell.help');
    expect(catalogIds()).toContain('peek.close');
    expect(widgetKeys()).toHaveLength(new Set(read('resources/js/lib/shortcuts/widgets.ts').match(/\blabel: '[^']+'/g)).size);
    expect(widgetKeys()).toContain('palette:move');
    expect(widgetKeys()).toContain('editor:table_menu');
    expect(widgetKeys().filter((key) => key.startsWith('table:'))).toHaveLength(7);
    expect(ALL).toEqual([
      { name: 'desktop-light', phone: false },
      { name: 'desktop-dark', phone: false },
      { name: 'phone-light', phone: true },
      { name: 'phone-dark', phone: true },
    ]);
  });

  it('names every shortcut and every widget key, and nothing else', () => {
    const named = [...Object.keys(SHORTCUT_TESTS), ...Object.keys(GAPS)];
    expect({
      withoutEntry: keys.filter((key) => !named.includes(key)),
      unknown: named.filter((key) => !keys.includes(key)),
      provenAndGap: Object.keys(SHORTCUT_TESTS).filter((key) => Object.hasOwn(GAPS, key)),
    }).toEqual({ withoutEntry: [], unknown: [], provenAndGap: [] });
  });

  it('proves every shortcut and widget key with a keyboard-only test in every project', () => {
    expect(Object.entries(SHORTCUT_TESTS).flatMap(([key, entry]) => problemsOf(key, entry)).join('\n')).toBe('');
  });

  it('gives every exception a reason and a place', () => {
    const tests = Object.values(SHORTCUT_TESTS).flatMap(proofsOf);
    for (const allowed of MOUSE_ALLOWED) {
      expect(allowed.reason.trim(), `MOUSE_ALLOWED ${allowed.file} › ${allowed.test}`).not.toBe('');
      expect(MOUSE.test(allowed.call), `MOUSE_ALLOWED ${allowed.call}: no mouse call to allow`).toBe(true);
      expect(
        tests.some((proof) => proof.file === allowed.file && proof.test === allowed.test),
        `MOUSE_ALLOWED ${allowed.file} › ${allowed.test}: no proof names this test`,
      ).toBe(true);
    }
    for (const gap of PROJECT_GAPS) {
      expect(gap.reason.trim(), `PROJECT_GAPS ${gap.key}`).not.toBe('');
      expect(Object.hasOwn(SHORTCUT_TESTS, gap.key), `PROJECT_GAPS ${gap.key}: no proof to complete`).toBe(true);
      for (const name of gap.projects) expect(ALL.map((project) => project.name), `PROJECT_GAPS ${gap.key}`).toContain(name);
    }
  });

  it('keeps the mouse out of the e2e helpers, so a test body hides none', () => {
    for (const file of fs.readdirSync(path.join(ROOT, 'e2e')).filter((name) => name.endsWith('.ts'))) {
      expect(mask(read(path.join('e2e', file))), `e2e/${file}`).not.toMatch(MOUSE);
    }
  });

  it.each(Object.entries(GAPS))('gap for Task 18: %s', (key, gap) => {
    expect(gap.file).toBe('TODO');
    expect(gap.test.trim(), key).not.toBe('');
  });
});

describe('the scanner of the specs', () => {
  it('finds a test by its title inside a describe and cuts its body at the matching bracket', () => {
    const source = [
      "test.describe('block', () => {",
      "  test('first (a) test', async ({ page }) => {",
      "    await page.keyboard.press(')');",
      '    // a ) in a comment and a { in /x{/',
      '    const re = /\\)/;',
      "    await expect(page.getByText(`${'}'} b`)).toBeVisible();",
      '  });',
      "  test('second', async ({ page }) => { await page.getByRole('button').click(); });",
      '});',
    ].join('\n');
    const calls = testCalls(source);
    expect(calls.map((call) => call.title)).toEqual(['first (a) test', 'second']);
    const first = source.slice(calls[0].start, calls[0].end);
    expect(first.endsWith('toBeVisible();\n  })')).toBe(true);
    expect(mask(first)).not.toMatch(MOUSE);
    expect(mask(source.slice(calls[1].start, calls[1].end))).toMatch(MOUSE);
  });

  it('finds the mouse in a helper of the spec, also through another helper', () => {
    const source = [
      'async function drag(page) { await page.mouse.down(); }',
      'const move = async (page, to: number) => { await drag(page); };',
      'function type(page) { return page.keyboard.press("a"); }',
      "test('moves', async ({ page }) => { await move(page, 1); });",
    ].join('\n');
    expect([...mouseHelpers(source)].sort()).toEqual(['drag', 'move']);
  });

  it('lets a test through only with every mouse call of it allowed', () => {
    const proof = { file: 'comments.spec.ts', test: 'keeps a draft over closing the preview' };
    const write = "preview.getByRole('button', { name: tr('en', 'items.comments.write') }).click()";
    const resume = "preview.getByRole('button', { name: tr('en', 'items.comments.continue') }).click()";
    const allow = (call) => ({ ...proof, call, reason: 'scanner test' });
    expect(() => provenIn(proof, [])).toThrow(/uses the mouse \(\.click\(\) at line \d+/);
    expect(() => provenIn(proof, [allow(write)])).toThrow(/uses the mouse/);
    expect(provenIn(proof, [allow(write), allow(resume)])).toEqual(ALL.map((project) => project.name));
    expect(() => provenIn(proof, [allow(write), allow(resume), allow('page.mouse.up()')])).toThrow(/names a call the test does not make/);
  });

  it('reads where a skipping test runs', () => {
    expect(provenIn({ file: 'shell.spec.ts', test: 'collapses the sidebar to the rail and back' })).toEqual(['desktop-light', 'desktop-dark']);
    expect(provenIn({ file: 'shell.spec.ts', test: 'opens the navigation drawer on the phone' })).toEqual(['phone-light', 'phone-dark']);
    expect(provenIn({ file: 'shell.spec.ts', test: 'goes to projects with g p' })).toEqual(ALL.map((project) => project.name));
  });

  it('reads no mouse call from a string or a comment', () => {
    expect(mask("const a = '.click('; // page.mouse\nconst b = `x ${y.hover} .tap(`;")).not.toMatch(MOUSE);
    expect(mask('const b = `x ${page.mouse.down()} y`;')).toMatch(MOUSE);
  });
});
