/*
 * Success criterion 6 (every flow without a mouse, Playwright checks it) as a test (A442, K16): e2e/keyboard-flows.ts maps
 * every id of the shortcut catalog and every key of a widget (`<group>:<label>`, the last parts of their translation keys,
 * `palette:move` for `shortcuts.widget.group.palette` and `shortcuts.widget.palette.move`) and every flow of `FLOWS` to a
 * Playwright test, and this file keeps that map complete and honest: the spec exists, the title stands there literally,
 * the body of that test (from its call to the matching bracket) uses no mouse, and a test that skips a project proves
 * nothing there.
 *
 * The catalog and the widgets are read as text: keyboard-flows.ts lives under e2e/ and imports nothing of the app (its
 * type check knows no `@/` alias), so only this test knows both sides.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { API_AFTER, FLOW_TESTS, GAPS, MOUSE_ALLOWED, PROJECT_GAPS, SHORTCUT_TESTS } from '../e2e/keyboard-flows.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

/**
 * The flows of the app, each with the section of the spec it comes from (chapters 4, 5.2 and 6.3): the list of Task 17b
 * first, then what the review of 17b and the existing tests added. Each one has a proof in `FLOW_TESTS` or a gap in
 * `GAPS`, and every flow named there stands here. A flow is named in words, so it never reads as a key (`item.state`,
 * `palette:move`). A new flow of the app comes into this list, with its test or its gap (CLAUDE.md, rule Tastatur).
 */
const FLOWS = [
  // the list of Task 17b
  'sign in and out', // 4.2, Fortify (3)
  'sign in with a second factor', // 4.2, Fortify (3)
  'reset a forgotten password', // 4.2
  'accept an invitation', // 4.2
  'create a project', // 4.4
  'add a member', // 4.4
  'create a workflow with a matrix', // 4.5
  'create a type with a required property', // 4.6, 4.7
  'create an item', // 4.8, 5.2 Anlegen-Dialog
  'change the status', // 4.8
  'change the assignee', // 4.8
  'change the priority', // 4.8
  'change the labels', // 4.8
  'change the type', // 4.8
  'change the dates', // 4.8
  'change the parent', // 4.8
  'add a relation', // 4.9
  'remove a relation', // 4.9
  'edit the description', // 4.8, 4.16
  'write a comment', // 4.10
  'paste an image', // 4.16
  'upload a file', // 4.16
  'edit several items at once', // 4.8
  'archive with undo', // 4.8
  'delete with undo', // 4.8
  'filter a list', // 4.11
  'save a list as a view', // 4.11
  'move a card on the board', // 4.11
  'edit a cell of the table', // 4.11
  'move an epic on the timeline', // 4.11
  'plan an epic on the timeline', // 4.11
  'search from the palette', // 4.17
  'jump to an item by its key', // 4.17
  'work the inbox', // 4.14
  'set the notifications', // 4.14, 5.2 Persönlich
  'create a wiki page', // 4.15
  'edit a wiki page', // 4.15
  'move a wiki page', // 4.15
  'delete a wiki page', // 4.15
  'restore a page version', // 4.15
  'create a template', // 4.12
  'run a template', // 4.12
  'set a schedule', // 4.12
  'switch an automation', // 4.13
  'create a webhook', // 6.3, 5.2 Organisation
  'ping a webhook', // 6.3
  'create a token', // 5.2 Persönlich, 6.1
  'set up a second factor', // 5.2 Persönlich
  'change the organization', // 4.1, 5.2 Organisation
  'open the system page', // 5.2 System
  'change the theme', // 4.17, 5.2
  'open and close the sidebar', // 5.2 Seitenleiste
  // the review of 17b: flows of chapters 4 and 5.2 the list above left out
  'edit a comment', // 4.10
  'delete a comment', // 4.10
  'react to a comment', // 4.10
  'paste an image into a comment', // 4.16
  'retry failed jobs', // 5.2 System
  'redeliver a webhook delivery', // 6.3, 5.2 Organisation
  'download a file', // 4.16
  'switch a schedule on', // 4.12
  // more of chapters 4 and 5.2 that a keyboard-only test already goes through
  'invite a person', // 4.2
  'create a bot with a token', // 4.2
  'change the profile', // 5.2 Persönlich
  'change the password', // 4.2, 5.2 Persönlich
  'change the role of a person', // 4.3
  'create a label', // 4.7
  'create a relation type', // 4.9
  'create a resolution', // 4.5
  'duplicate a workflow', // 4.5
  'switch the workflow of a project', // 4.5
  'switch on a type for a project', // 4.6
  'archive and restore a project', // 4.4
  'delete a project', // 4.4
  'apply a template in the dialog', // 4.12, 5.2 Anlegen-Dialog
  'create several items in a row', // 5.2 Anlegen-Dialog
  'create a child item', // 4.8
  'restore an archived item', // 4.8
  'create an item on the board', // 4.11
  'change the display of a list', // 4.11, 5.2 Item-Listen
  'star a view', // 4.11, 5.2 Seitenleiste
  'paste an image into a wiki page', // 4.15, 4.16
  // what Phase 15 brought after Task 17
  'link a referenced item', // 4.13, A452 (Erwähnte Items verknüpfen)
  'move a card where the ranks ran out', // 4.11, A448
  'open a wiki page of an item', // 4.8, 4.15, A456
  'edit a table in the editor', // 4.16, A454
];
/** A name of `GAPS` with a space is a flow, one without a key of the catalog or the widgets. */
const isFlow = (name) => /\s/.test(name);

/** What a keyboard-only test may not do: pointer calls of Playwright and synthetic pointer events. */
const MOUSE = /\.(?:click|dblclick|hover|dragTo|tap|setChecked|uncheck|selectOption)\s*\(|(?<!\bfonts)\.check\s*\(|\.mouse\b|\.touchscreen\b|dispatchEvent\(\s*new\s+(?:Mouse|Pointer|Touch|Drag)Event\b|dispatchEvent\(\s*['"](?:click|dblclick|mouse|pointer|touch|drag)/;

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

/** The functions of a spec (declarations and arrow functions bound to a name): name → [start, end] in its source. */
function functions(masked) {
  const found = new Map();
  for (const match of masked.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(|\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:\([^()]*(?:\([^()]*\)[^()]*)*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>/g)) {
    const name = match[1] ?? match[2];
    let at = match.index + match[0].length;
    if (match[1]) at = closing(masked, at - 1) + 1;
    while (at < masked.length && masked[at] !== '{' && masked[at] !== '\n' && masked[at] !== ';') at++;
    found.set(name, [match.index, masked[at] === '{' ? closing(masked, at) + 1 : at]);
  }
  return found;
}

/** The functions of the spec that `text` calls, also through each other, in the order they are reached. */
function reach(text, fns, masked) {
  const reached = [];
  const queue = [text];
  while (queue.length > 0) {
    const next = queue.shift();
    for (const [name, [start, end]] of fns) {
      if (!reached.includes(name) && new RegExp(`(?<![\\w.$])${escape(name)}\\s*\\(`).test(next)) {
        reached.push(name);
        queue.push(masked.slice(start, end));
      }
    }
  }
  return reached;
}

/**
 * The names of functions of a spec that use a mouse, also through another such function of the same file. A test that
 * calls one uses the mouse as much as one that clicks itself.
 */
function mouseHelpers(source, masked = mask(source)) {
  const fns = functions(masked);
  const uses = (name) => MOUSE.test(masked.slice(...fns.get(name)));
  return new Set([...fns.keys()].filter((name) => uses(name) || reach(masked.slice(...fns.get(name)), fns, masked).some(uses)));
}

/**
 * A write over the API or the server instead of the page: a POST, PUT, PATCH or DELETE (`api(page, 'POST', …)`,
 * `page.request.post(…)`) and the helpers that create or run something (`createItem`, `createE2e…`, `uploadViaApi`,
 * `artisan`, `makeTemplateDue`). Read on the source, where the method of `api` still stands.
 */
const WRITE = /(?<![\w.$])api\(\s*[\w.]+\s*,\s*['"`](?:POST|PUT|PATCH|DELETE)['"`]|\.request\.(?:post|put|patch|delete)\s*\(|(?<![\w.$])(?:createItem|createE2e\w*|uploadViaApi|artisan|artisanEval|makeTemplateDue)\s*\(/g;
/** Input of the keyboard: a key, a typed text, a field filled, or a helper of e2e/helpers.ts that moves the focus. */
const INPUT = /\.keyboard\.|(?<![\w.$])(?:pressMod|tabTo|arrowTo)\s*\(|\.(?:press|fill|type|pressSequentially)\s*\(/g;

let helperFile;
/** e2e/helpers.ts read once like a spec: its functions count when a test or a function of a spec calls them. */
function helperSpec() {
  helperFile ??= readSpec('../helpers.ts', read('e2e/helpers.ts'));
  return helperFile;
}

/** The function `name` as the spec sees it (its own first, then e2e/helpers.ts): where it stands, or undefined. */
function lookup(name, parsed) {
  for (const file of [parsed, helperSpec()]) {
    if (file.fns.has(name)) return { file, range: file.fns.get(name) };
  }
  return undefined;
}

/** Whether a function of the spec or of e2e/helpers.ts gives keyboard input and writes over the API, also through others. */
function classify(name, parsed, seen = new Set()) {
  const found = lookup(name, parsed);
  if (!found || seen.has(name)) return { input: false, write: false };
  seen.add(name);
  const { file, range } = found;
  const kind = { input: false, write: false };
  for (const event of eventsIn(file, range)) {
    if (event.input) kind.input = true;
    if (event.write) kind.write = true;
    if (event.call) {
      const inner = classify(event.call, parsed, seen);
      kind.input ||= inner.input;
      kind.write ||= inner.write;
    }
  }
  return kind;
}

/** The inputs, writes and calls of a range of a file in their order, without what stands in a `finally` block. */
function eventsIn(file, [from, to], blanked = []) {
  let masked = file.masked.slice(from, to);
  for (const [at, length] of blanked) masked = masked.slice(0, at) + ' '.repeat(length) + masked.slice(at + length);
  for (const match of masked.matchAll(/(?<![\w$])finally\s*\{/g)) {
    const end = closing(masked, match.index + match[0].length - 1) + 1;
    masked = masked.slice(0, match.index) + masked.slice(match.index, end).replace(/[^\n]/g, ' ') + masked.slice(end);
  }
  const code = (at) => masked[at] !== ' ';
  const source = file.source.slice(from, to);
  const events = [
    ...[...masked.matchAll(INPUT)].map((match) => ({ at: match.index, input: true })),
    ...[...source.matchAll(WRITE)].filter((match) => code(match.index + match[0].search(/\S/))).map((match) => ({ at: match.index, write: true, text: match[0].trim() })),
    ...[...masked.matchAll(/(?<![\w.$])([A-Za-z_$][\w$]*)\s*\(/g)].map((match) => ({ at: match.index, call: match[1], text: match[0].replace(/\s+/g, '') })),
  ];
  return events.sort((a, b) => a.at - b.at).map((event) => ({ ...event, line: file.source.slice(0, from + event.at).split('\n').length }));
}

/**
 * The writes over the API of a test that come after its first keyboard input, outside `finally` (the flow itself done
 * over the API): directly or through a function of the spec or of e2e/helpers.ts. `allowed` names calls as they stand in
 * the test (API_AFTER); a name the test does not make throws.
 */
function lateWrites(parsed, call, allowed = []) {
  const blanked = allowed.map((text) => {
    const at = parsed.source.slice(call.start, call.end).indexOf(text);
    if (at === -1) throw new Error(`API_AFTER names a call the test does not make: ${text}`);
    return [at, text.length];
  });
  const walk = (file, range, seen) => {
    const late = [];
    let keyed = false;
    const events = eventsIn(file, range, file === parsed && range[0] === call.start ? blanked : []);
    // `createItem(` and `api(page, 'POST'` are a write already, not a call to look into
    const writes = new Set(events.filter((event) => event.write).map((event) => event.at));
    for (const event of events) {
      if (event.input) keyed = true;
      else if (event.write) {
        if (keyed) late.push(event);
      } else if (event.call && !seen.has(event.call) && !writes.has(event.at)) {
        const kind = classify(event.call, parsed);
        if (kind.write && keyed) late.push(event);
        else if (kind.write && kind.input) {
          const found = lookup(event.call, parsed);
          late.push(...walk(found.file, found.range, new Set([...seen, event.call])));
        }
        if (kind.input) keyed = true;
      }
    }
    return late;
  };
  return walk(parsed, [call.start, call.end], new Set());
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The keys of every entry as the register writes them: a catalog id → its keys, a widget key → the keys of its label. */
function entryKeys() {
  const keys = new Map();
  const catalog = read('resources/js/lib/shortcuts/catalog.ts');
  for (const [, id, combo] of catalog.slice(catalog.indexOf('export const SHORTCUTS = {')).matchAll(/^ {2}'([a-z0-9_.]+)': \{ keys: '([^']+)'/gm)) {
    keys.set(id, [combo]);
  }
  for (const part of read('resources/js/lib/shortcuts/widgets.ts').split(/\bgroup: '/).slice(1)) {
    const name = part.slice(0, part.indexOf("'")).replace(/^shortcuts\.widget\.group\./, '');
    for (const [, combo, label] of part.matchAll(/\{ keys: '([^']+)', label: '([^']+)' \}/g)) {
      const key = `${name}:${label.slice(`shortcuts.widget.${name}.`.length)}`;
      keys.set(key, [...(keys.get(key) ?? []), combo]);
    }
  }
  return keys;
}
const KEYS = entryKeys();

/** Register names whose Playwright name differs. */
const PLAYWRIGHT = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', escape: 'Escape', enter: 'Enter', backspace: 'Backspace', home: 'Home', end: 'End', tab: 'Tab', space: ' ' };

/**
 * How a test presses a key of the register (`mod+enter`, `shift+x`, `g i`): a sequence by its last step, `mod` only as
 * `pressMod(page, '<key>')` or `ControlOrMeta+<key>`, otherwise the literal Playwright presses (`'Shift+X'`,
 * `'Alt+ArrowDown'`, `' '`), and a sign like `@`, `#` or `/` also typed inside a text. A letter typed in a text is no
 * shortcut, so it does not count.
 */
function pressings(combo) {
  const parts = combo.trim().split(/\s+/).at(-1).split('+');
  const base = parts.pop();
  const name = PLAYWRIGHT[base.toLowerCase()] ?? base;
  if (parts.includes('mod')) return [{ text: `pressMod(…, '${name}')`, mod: name }, { text: `'ControlOrMeta+${name}'`, literal: `ControlOrMeta+${name}` }];
  const prefix = `${parts.includes('alt') ? 'Alt+' : ''}${parts.includes('shift') ? 'Shift+' : ''}`;
  const names = parts.includes('shift') && /^[a-z]$/i.test(name) ? [name.toUpperCase(), name.toLowerCase()] : name === ' ' ? [' ', 'Space'] : [name];
  const forms = names.map((each) => ({ text: `'${prefix}${each}'`, literal: `${prefix}${each}` }));
  if (prefix === '' && /^[^\w\s]$/.test(name)) forms.push({ text: `${name} in a typed text`, typed: name });
  return forms;
}

/** The bracket that holds `at` in masked source, and the name called before it if it is a `(`. */
function enclosing(masked, at) {
  let depth = 0;
  for (let i = at - 1; i >= 0; i--) {
    if (')]}'.includes(masked[i])) depth++;
    else if ('([{'.includes(masked[i])) {
      if (depth === 0) return { bracket: masked[i], callee: masked.slice(0, i).match(/([A-Za-z_$][\w$]*)\s*$/)?.[1] };
      depth--;
    }
  }
  return { bracket: null };
}

/** Calls of Playwright that press what they get. */
const PRESSING = new Set(['press', 'pressMod', 'down']);

/**
 * Whether `form` stands as code in one of the ranges of a spec: a string literal (not a comment) handed to a call that
 * presses it (`press`, `pressMod`, `keyboard.down`), to a function of the spec (`subList(page, 's', …)`, which presses
 * it), or in an array (the keys a loop presses). `page.locator('p')` names an element, no key.
 */
function pressedIn(form, source, masked, ranges, fns) {
  const inside = (at) => masked[at] !== ' ' && ranges.some(([start, end]) => start <= at && at < end);
  if (form.mod !== undefined) {
    return [...source.matchAll(new RegExp(`pressMod\\(\\s*[\\w.]+\\s*,\\s*(['"\`])${escape(form.mod)}\\1`, 'g'))].some((match) => inside(match.index));
  }
  if (form.typed !== undefined) {
    return [...source.matchAll(/\.(?:type|insertText)\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)].some((match) => inside(match.index) && match[2].includes(form.typed));
  }
  return [...source.matchAll(new RegExp(`(['"\`])${escape(form.literal)}\\1`, 'g'))].some((match) => {
    if (!inside(match.index)) return false;
    const { bracket, callee } = enclosing(masked, match.index);
    // the key of a pressMod(page, 'Enter') is ⌘↵, not a plain Enter
    if (callee === 'pressMod') return false;
    return bracket === '[' || (bracket === '(' && (PRESSING.has(callee) || fns.has(callee)));
  });
}

/** The ranges of the skips of a body (`test.skip(…)`, `test.fixme(…)`) relative to it, with the condition they read. */
function skipsOf(body, source, start) {
  return [...body.matchAll(/(?<![\w$])test\.(?:skip|fixme)\s*\(/g)].map((skip) => {
    const open = skip.index + skip[0].length - 1;
    const end = closing(body, open) + 1;
    return { from: skip.index, to: end, condition: source.slice(start + open + 1, start + end - 1).split(',')[0].replace(/\s+/g, '') };
  });
}

const specs = new Map();
/** A spec of e2e/tests read once: source, masked source, its tests (with those in a skipped describe) and its functions. */
function spec(file) {
  if (!specs.has(file)) specs.set(file, readSpec(file, read(path.join('e2e/tests', file))));
  return specs.get(file);
}

/** What the checks read of a spec. */
function readSpec(file, source) {
  const masked = mask(source);
  const tests = testCalls(source, masked);
  // a skip outside a test (in a describe, a hook) would hold for tests this check reads as running everywhere
  for (const skip of masked.matchAll(/(?<![\w$])test\.(?:skip|fixme)\s*\(/g)) {
    if (!tests.some((call) => call.start < skip.index && skip.index < call.end)) throw new Error(`${file}: test.skip or test.fixme outside a test, which this check does not read`);
  }
  // test.describe.skip and .fixme run none of their tests
  const skipped = [...masked.matchAll(/(?<![\w$])test\.describe\.(?:skip|fixme)\s*\(/g)].map((match) => [match.index, closing(masked, match.index + match[0].length - 1)]);
  for (const call of tests) call.nowhere = skipped.some(([from, to]) => from < call.start && call.end <= to);
  return { source, masked, tests, fns: functions(masked) };
}

const ALL = projects();
const proofsOf = (entry) => (Array.isArray(entry) ? entry : [entry]);

/**
 * Where a proof of `key` holds (`key` null: a flow, which presses no key of its own): the projects its test runs in (a
 * `test.skip(isPhone(page), …)` leaves out the phones, one with `!isPhone` the desktops, one without a condition and a
 * skipped describe all of them), narrowed to `projects` if the entry names them; a test that branches on `isPhone()` must
 * name them. A flow writes over the API only before its first key or in `finally` (`lateWrites`). Throws what is wrong
 * with the proof.
 */
function provenIn(proof, key, allowances = MOUSE_ALLOWED, apiAllowances = API_AFTER) {
  const where = `${proof.file} › ${proof.test}`;
  if (!fs.existsSync(path.join(ROOT, 'e2e/tests', proof.file))) throw new Error(`${proof.file}: no such spec under e2e/tests`);
  const { source, masked, tests, fns } = spec(proof.file);
  const found = tests.filter((call) => call.title === proof.test);
  if (found.length === 0) throw new Error(`${where}: no test('…') with this title`);
  if (found.length > 1) throw new Error(`${where}: the title stands ${found.length} times`);
  const { start, end, nowhere } = found[0];

  let body = masked.slice(start, end);
  for (const allowed of allowances.filter((entry) => entry.file === proof.file && entry.test === proof.test)) {
    const at = source.slice(start, end).indexOf(allowed.call);
    if (at === -1) throw new Error(`${where}: MOUSE_ALLOWED names a call the test does not make: ${allowed.call}`);
    body = body.slice(0, at) + ' '.repeat(allowed.call.length) + body.slice(at + allowed.call.length);
  }
  const mouse = body.match(MOUSE);
  if (mouse) throw new Error(`${where}: uses the mouse (${mouse[0].trim()}) at line ${source.slice(0, start + body.indexOf(mouse[0])).split('\n').length}`);
  const helpers = reach(body, fns, masked);
  for (const helper of helpers) {
    if (MOUSE.test(masked.slice(...fns.get(helper)))) throw new Error(`${where}: reaches ${helper}(), which uses the mouse`);
  }

  if (key === null) {
    const allowed = apiAllowances.filter((entry) => entry.file === proof.file && entry.test === proof.test).map((entry) => entry.call);
    const late = lateWrites(spec(proof.file), found[0], allowed);
    if (late.length > 0) {
      throw new Error(`${where}: writes over the API after its first key (${late.map((write) => `${write.text} at line ${write.line}`).join(', ')}): set it up before the keys, clean up in finally, or name it in API_AFTER with a reason`);
    }
  } else {
    if (!KEYS.has(key)) throw new Error(`${where}: ${key} is no key of the catalog or the widgets`);
    const ranges = [[start, end], ...helpers.map((helper) => fns.get(helper))];
    const forms = KEYS.get(key).flatMap(pressings);
    if (!forms.some((form) => pressedIn(form, source, masked, ranges, fns))) throw new Error(`${where}: presses none of: ${forms.map((form) => form.text).join(', ')}`);
  }

  let runs = nowhere ? [] : ALL.map((project) => project.name);
  const skips = skipsOf(body, source, start);
  for (const { condition } of skips) {
    if (condition === '') runs = [];
    else if (condition === 'isPhone(page)') runs = runs.filter((name) => !ALL.find((project) => project.name === name).phone);
    else if (condition === '!isPhone(page)') runs = runs.filter((name) => ALL.find((project) => project.name === name).phone);
    else throw new Error(`${where}: test.skip(${condition}, …) is a condition this test does not read; name the projects`);
  }
  let unskipped = body;
  for (const { from, to } of skips) unskipped = unskipped.slice(0, from) + ' '.repeat(to - from) + unskipped.slice(to);
  const branches = [unskipped, ...helpers.map((helper) => masked.slice(...fns.get(helper)))].some((text) => /(?<![\w.$])isPhone\s*\(/.test(text));
  if (proof.projects === undefined) {
    if (branches) throw new Error(`${where}: branches on isPhone(): name the projects where it presses the key or goes through the flow`);
    return runs;
  }
  for (const name of proof.projects) {
    if (!ALL.some((project) => project.name === name)) throw new Error(`${where}: no Playwright project ${name}`);
    if (!runs.includes(name)) throw new Error(`${where}: claims ${name}, where the test skips`);
  }
  return proof.projects;
}

/** What is wrong with the proofs of one key or flow (`key` null), across all projects (none: an empty list). */
function problemsOf(name, entry, key = name) {
  const problems = [];
  const covered = new Set();
  for (const proof of proofsOf(entry)) {
    try {
      for (const project of provenIn(proof, key)) covered.add(project);
    } catch (error) {
      problems.push(`${name}: ${error.message}`);
    }
  }
  const excused = PROJECT_GAPS.filter((gap) => gap.key === name).flatMap((gap) => gap.projects);
  for (const project of excused) if (covered.has(project)) problems.push(`${name}: PROJECT_GAPS excuses ${project}, which a proof covers`);
  for (const project of ALL) if (!covered.has(project.name) && !excused.includes(project.name)) problems.push(`${name}: nothing proves it in ${project.name} (a proof, or PROJECT_GAPS with a reason)`);
  return problems;
}

/** The proofs of `FLOW_TESTS` by flow, in the order they stand. */
function flowProofs(flows = FLOW_TESTS) {
  const byFlow = new Map();
  for (const { flow, ...proof } of flows) byFlow.set(flow, [...(byFlow.get(flow) ?? []), proof]);
  return byFlow;
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
    // and the keys of every entry, for the check that a test presses one of them
    expect([...catalogIds(), ...widgetKeys()].filter((key) => !KEYS.has(key))).toEqual([]);
    expect(KEYS.get('shell.go.inbox')).toEqual(['g i']);
    expect(KEYS.get('palette:move')).toEqual(['up', 'down']);
    expect(KEYS.get('editor:table_menu')).toEqual(['alt+F10']);
    expect(ALL).toEqual([
      { name: 'desktop-light', phone: false },
      { name: 'desktop-dark', phone: false },
      { name: 'phone-light', phone: true },
      { name: 'phone-dark', phone: true },
    ]);
  });

  it('names every shortcut and every widget key, and nothing else', () => {
    const named = [...Object.keys(SHORTCUT_TESTS), ...Object.keys(GAPS).filter((name) => !isFlow(name))];
    expect({
      withoutEntry: keys.filter((key) => !named.includes(key)),
      unknown: named.filter((key) => !keys.includes(key)),
      provenAndGap: Object.keys(SHORTCUT_TESTS).filter((key) => Object.hasOwn(GAPS, key)),
    }).toEqual({ withoutEntry: [], unknown: [], provenAndGap: [] });
  });

  it('lists every flow', () => {
    const proven = [...new Set(FLOW_TESTS.map((proof) => proof.flow))];
    const gaps = Object.keys(GAPS).filter(isFlow);
    expect(FLOWS.filter((flow) => !isFlow(flow)), 'a flow in FLOWS without a space reads as a key').toEqual([]);
    expect(FLOWS.filter((flow, at) => FLOWS.indexOf(flow) !== at), 'twice in FLOWS').toEqual([]);
    expect({
      withoutEntry: FLOWS.filter((flow) => !proven.includes(flow) && !gaps.includes(flow)),
      // a name in FLOW_TESTS or GAPS that FLOWS does not hold: a typo, or a flow missing in the list
      provenNotListed: proven.filter((flow) => !FLOWS.includes(flow)),
      gapNotListed: gaps.filter((flow) => !FLOWS.includes(flow)),
      provenAndGap: proven.filter((flow) => gaps.includes(flow)),
    }).toEqual({ withoutEntry: [], provenNotListed: [], gapNotListed: [], provenAndGap: [] });
  });

  it('proves every shortcut and widget key with a keyboard-only test in every project', () => {
    expect(Object.entries(SHORTCUT_TESTS).flatMap(([key, entry]) => problemsOf(key, entry)).join('\n')).toBe('');
  });

  it('proves every flow with a keyboard-only test in every project', () => {
    expect([...flowProofs()].flatMap(([flow, proofs]) => problemsOf(flow, proofs, null)).join('\n')).toBe('');
  });

  it('gives every exception a reason and a place', () => {
    const tests = [...Object.values(SHORTCUT_TESTS).flatMap(proofsOf), ...FLOW_TESTS];
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
      expect(Object.hasOwn(SHORTCUT_TESTS, gap.key) || flowProofs().has(gap.key), `PROJECT_GAPS ${gap.key}: no proof to complete`).toBe(true);
      for (const name of gap.projects) expect(ALL.map((project) => project.name), `PROJECT_GAPS ${gap.key}`).toContain(name);
    }
  });

  it('keeps the mouse out of the e2e helpers, so a test body hides none', () => {
    const files = fs.readdirSync(path.join(ROOT, 'e2e')).filter((name) => name.endsWith('.ts'));
    expect(files).toContain('helpers.ts');
    expect(files).toContain('fixtures.ts');
    for (const file of files) {
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
    // the test opens the preview with the space bar (list.peek), then clicks twice
    expect(() => provenIn(proof, 'list.peek', [])).toThrow(/uses the mouse \(\.click\(\) at line \d+/);
    expect(() => provenIn(proof, 'list.peek', [allow(write)])).toThrow(/uses the mouse/);
    expect(provenIn(proof, 'list.peek', [allow(write), allow(resume)])).toEqual(ALL.map((project) => project.name));
    expect(() => provenIn(proof, 'list.peek', [allow(write), allow(resume), allow('page.mouse.up()')])).toThrow(/names a call the test does not make/);
  });

  it('reads where a skipping test runs', () => {
    expect(provenIn({ file: 'shell.spec.ts', test: 'collapses the sidebar to the rail and back' }, 'palette:close')).toEqual(['desktop-light', 'desktop-dark']);
    expect(provenIn({ file: 'shell.spec.ts', test: 'opens the navigation drawer on the phone' }, 'palette:close')).toEqual(['phone-light', 'phone-dark']);
    expect(provenIn({ file: 'shell.spec.ts', test: 'goes to projects with g p' }, 'shell.go.projects')).toEqual(ALL.map((project) => project.name));
  });

  it('wants one of the keys of the entry in the test or in a helper of the spec it calls', () => {
    const title = { file: 'items.spec.ts', test: 'edits the title with e' };
    expect(() => provenIn(title, 'item.labels')).toThrow(/presses none of: 'l'/);
    expect(provenIn(title, 'item.title')).toEqual(ALL.map((project) => project.name));
    // c through openDialog, mod+enter as pressMod(page, 'Enter'), ⇧X, ⌥↓, a sequence by its last key, @ typed in a text
    expect(provenIn({ file: 'create-item.spec.ts', test: 'creates an item of a type with a required property' }, 'item.create')).toHaveLength(4);
    expect(provenIn({ file: 'create-item.spec.ts', test: 'creates an item of a type with a required property' }, 'dialog.submit')).toHaveLength(4);
    expect(provenIn({ file: 'bulk.spec.ts', test: 'selects a range with shift+x, archives with mod+backspace and undoes with mod+z' }, 'list.select_range')).toHaveLength(4);
    expect(provenIn({ file: 'board.spec.ts', test: 'changes the place of a card in its column with alt+arrow and keeps the focus on it' }, 'list.move_down')).toHaveLength(4);
    expect(provenIn({ file: 'shell.spec.ts', test: 'reaches the other main places with their g sequences' }, 'shell.go.views')).toHaveLength(4);
    expect(provenIn({ file: 'editor.spec.ts', test: 'mentions over @ and refers over #' }, 'editor:mention')).toHaveLength(4);
    // a letter typed in a text is no shortcut, ⌘↵ is no plain Enter
    expect(() => provenIn({ file: 'editor.spec.ts', test: 'mentions over @ and refers over #' }, 'item.priority')).toThrow(/presses none of: 'p'/);
    expect(() => provenIn({ file: 'shell.spec.ts', test: 'goes to projects with g p' }, 'settings.save')).toThrow(/presses none of: pressMod\(…, 'Enter'\)/);
  });

  it('reads a flow like a key, without a key to press', () => {
    const drawer = { file: 'shell.spec.ts', test: 'opens the navigation drawer on the phone' };
    const rail = { file: 'shell.spec.ts', test: 'collapses the sidebar to the rail and back' };
    // the drawer presses no key of item.title, yet it proves a flow on the phones
    expect(() => provenIn(drawer, 'item.title')).toThrow(/presses none of: 'e'/);
    expect(provenIn(drawer, null)).toEqual(['phone-light', 'phone-dark']);
    // the mouse and a branch on isPhone count for a flow as for a key
    expect(() => provenIn({ file: 'comments.spec.ts', test: 'keeps a draft over closing the preview' }, null)).toThrow(/uses the mouse/);
    expect(() => provenIn({ file: 'items.spec.ts', test: 'changes assignee and priority with a and p' }, null)).toThrow(/branches on isPhone\(\): name the projects/);
    // the proofs of a flow stand in FLOW_TESTS one by one; together the widths prove it everywhere
    const proofs = flowProofs([
      { flow: 'open and close the sidebar', ...rail },
      { flow: 'create a project', file: 'projects.spec.ts', test: 'creates a project with the keyboard from the sidebar' },
      { flow: 'open and close the sidebar', ...drawer },
    ]);
    expect([...proofs.keys()]).toEqual(['open and close the sidebar', 'create a project']);
    expect(problemsOf('open and close the sidebar', proofs.get('open and close the sidebar'), null)).toEqual([]);
    expect(problemsOf('open and close the sidebar', [rail], null)).toEqual([
      'open and close the sidebar: nothing proves it in phone-light (a proof, or PROJECT_GAPS with a reason)',
      'open and close the sidebar: nothing proves it in phone-dark (a proof, or PROJECT_GAPS with a reason)',
    ]);
  });

  it('wants every write over the API of a flow before its first key, or in finally', () => {
    const parsed = readSpec(
      'x.spec.ts',
      [
        'async function setUp(page) { await createItem(page, {}); }',
        "async function openIt(page) { await page.keyboard.press('c'); }",
        "async function both(page) { await page.keyboard.press('c'); await api(page, 'PATCH', '/x'); }",
        "test('early', async ({ page }) => { await setUp(page); await openIt(page); try { await page.keyboard.press('Enter'); } finally { await api(page, 'DELETE', '/x'); } });",
        "test('late', async ({ page }) => { await openIt(page); await createItem(page, {}); });",
        "test('late helper', async ({ page }) => { await tabTo(page, x); await setUp(page); });",
        "test('inside', async ({ page }) => { await both(page); });",
        "test('request', async ({ page }) => { await pressMod(page, 'Enter'); await page.request.post('/x'); });",
        "test('reads', async ({ page }) => { await page.keyboard.press('j'); await api(page, 'GET', '/x'); });",
      ].join('\n'),
    );
    const late = (title, allowed = []) => lateWrites(parsed, parsed.tests.find((call) => call.title === title), allowed).map((write) => write.text);
    expect(late('early')).toEqual([]);
    expect(late('reads')).toEqual([]);
    expect(late('late')).toEqual(['createItem(']);
    expect(late('late helper')).toEqual(['setUp(']);
    expect(late('inside')).toEqual(["api(page, 'PATCH'"]);
    expect(late('request')).toEqual(['.request.post(']);
    // an allowed write goes through, an allowance for a write the test does not make throws
    expect(late('late', ['createItem(page, {})'])).toEqual([]);
    expect(() => late('late', ['createE2eProject(page'])).toThrow(/API_AFTER names a call the test does not make/);
    // the helpers of e2e/helpers.ts count as well: createProjectFromSidebar types, removeE2eProject writes
    expect(classify('createProjectFromSidebar', parsed)).toMatchObject({ input: true });
    expect(classify('removeE2eProject', parsed)).toMatchObject({ write: true });
  });

  it('wants the projects named where the test branches on isPhone', () => {
    const search = { file: 'shell.spec.ts', test: 'opens the palette with / and from the search button, also on the phone' };
    expect(() => provenIn(search, 'shell.search')).toThrow(/branches on isPhone\(\): name the projects/);
    expect(provenIn({ ...search, projects: ['desktop-light', 'phone-dark'] }, 'shell.search')).toEqual(['desktop-light', 'phone-dark']);
    // a skip on isPhone is read, not a branch
    expect(provenIn({ file: 'shell.spec.ts', test: 'collapses the sidebar to the rail and back' }, 'palette:close')).toHaveLength(2);
  });

  it('reads test.fixme, test.describe.skip and a skip outside a test', () => {
    const parsed = readSpec(
      'x.spec.ts',
      [
        "test.describe.skip('off', () => {",
        "  test('a', async ({ page }) => { await page.keyboard.press('j'); });",
        '});',
        "test('b', async ({ page }) => { test.fixme(); await page.keyboard.press('k'); });",
        "test('c', async ({ page }) => { test.fixme(!isPhone(page), 'phone only'); });",
      ].join('\n'),
    );
    expect(parsed.tests.map((call) => [call.title, call.nowhere])).toEqual([
      ['a', true],
      ['b', false],
      ['c', false],
    ]);
    const conditions = (call) => skipsOf(parsed.masked.slice(call.start, call.end), parsed.source, call.start).map((skip) => skip.condition);
    expect(conditions(parsed.tests[1])).toEqual(['']);
    expect(conditions(parsed.tests[2])).toEqual(['!isPhone(page)']);
    expect(() => readSpec('y.spec.ts', "test.beforeEach(async ({ page }) => { test.fixme(isPhone(page)); });")).toThrow(/outside a test/);
  });

  it('reads no mouse call from a string or a comment', () => {
    expect(mask("await page.getByRole('checkbox').check();")).toMatch(MOUSE);
    expect(mask("await page.locator('select').selectOption('a');")).toMatch(MOUSE);
    expect(mask("const fonts = await page.evaluate(() => document.fonts.check('16px Figtree'));")).not.toMatch(MOUSE);
    expect(mask("const a = '.click('; // page.mouse\nconst b = `x ${y.hover} .tap(`;")).not.toMatch(MOUSE);
    expect(mask('const b = `x ${page.mouse.down()} y`;')).toMatch(MOUSE);
  });
});
