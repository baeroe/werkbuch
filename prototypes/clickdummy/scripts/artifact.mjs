// Turns the review build's page (dist-review/index.html) into the fragment a claude.ai artifact takes; the host wraps
// it in a page of its own and serves the files of assets/ beside it.
//
//   - It starts with <title> and <meta name="claude:viewport-fit-sides" content="cover">.
//   - No <!doctype>, <html>, <head> or <body>. Charset, viewport, theme colours and the icon go too: the host's page
//     brings them.
//   - The module script, the module preloads and the stylesheet stay as they are, relative: assets/…
//   - The theme script stays inline ahead of the app, so the theme is there before the first paint; it also sets the
//     language that <html lang> carried.
//
// pnpm build:review runs it after `vite build --mode review`. A fragment comes out as it went in.
//
//   node scripts/artifact.mjs [dist-review/index.html]

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TITLE = 'werkbuch Klickdummy';
const HEAD = `<title>${TITLE}</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n`;

/** The fragment of a built page; throws when the page has no app script or no root to mount it in. */
export function toFragment(html) {
  const lang = html.match(/<html\b[^>]*\blang="([^"]+)"/i)?.[1] ?? 'de';
  const setLang = `document.documentElement.lang = '${lang}';`;

  const fragment = html
    .replace(/<!doctype[^>]*>/gi, '')
    .replace(/<\/?(?:html|head|body)\b[^>]*>/gi, '')
    .replace(/<title>[\s\S]*?<\/title>/gi, '')
    .replace(/<meta\b[^>]*\bname="claude:viewport-fit-sides"[^>]*>/gi, '')
    .replace(/<meta\b[^>]*\bcharset=[^>]*>/gi, '')
    .replace(/<meta\b[^>]*\bname="(?:viewport|theme-color)"[^>]*>/gi, '')
    .replace(/<link\b[^>]*\brel="icon"[^>]*>/gi, '')
    // relative to the page, without "./": the paths the host publishes the files under
    .replace(/\b(src|href)="\.?\/assets\//g, '$1="assets/')
    // the theme script (the inline one) sets the language too
    .replace(/<script>(?![\s\S]*?documentElement\.lang)/, `<script>\n      ${setLang}`)
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '')
    .join('\n');

  if (!/<script type="module"[^>]*\bsrc="assets\/[^"]+\.js"[^>]*><\/script>/.test(fragment)) {
    throw new Error('artifact: the page has no module script under assets/ (was it built with pnpm build:review?)');
  }
  if (!fragment.includes('<div id="root"></div>')) throw new Error('artifact: the page has no <div id="root"> to mount the app in');
  return `${HEAD}${fragment}\n`;
}

function main() {
  const file = path.resolve(process.argv[2] ?? path.join(import.meta.dirname, '..', 'dist-review', 'index.html'));
  writeFileSync(file, toFragment(readFileSync(file, 'utf8')));
  console.log(`artifact: ${path.relative(process.cwd(), file)} is a fragment now`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
