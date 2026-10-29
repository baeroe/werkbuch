// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { toFragment } from './artifact.mjs';

/** index.html as `vite build --mode review` writes it: base './', the theme script inline, the icon over several lines. */
const BUILT = `<!doctype html>
<html lang="de">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <meta name="theme-color" content="#F5F7F9" media="(prefers-color-scheme: light)" />
    <meta name="theme-color" content="#181E28" media="(prefers-color-scheme: dark)" />
    <title>werkbuch Klickdummy</title>
    <link
      rel="icon"
      href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3C/svg%3E"
    />
    <script>
      // Theme before the first paint.
      try {
        var theme = localStorage.getItem('werkbuch:theme');
        if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
      } catch (error) {
        // storage blocked: follow the OS
      }
    </script>
    <script type="module" crossorigin src="./assets/index-BgMe6OX6.js"></script>
    <link rel="modulepreload" crossorigin href="./assets/rolldown-runtime-Dx1.js">
    <link rel="stylesheet" crossorigin href="./assets/index-C2xQ.css">
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`;

describe('toFragment', () => {
  const fragment = toFragment(BUILT);

  it('starts with the title and the viewport meta of the artifact', () => {
    expect(fragment.startsWith('<title>werkbuch Klickdummy</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n')).toBe(true);
    expect(fragment.match(/<title>/g)).toHaveLength(1);
  });

  it('has no document of its own: no doctype, html, head or body', () => {
    expect(fragment).not.toMatch(/<!doctype/i);
    expect(fragment).not.toMatch(/<\/?(html|head|body)\b/i);
  });

  it('keeps the module script, the preload and the stylesheet, relative to assets/', () => {
    expect(fragment).toContain('<script type="module" crossorigin src="assets/index-BgMe6OX6.js"></script>');
    expect(fragment).toContain('<link rel="modulepreload" crossorigin href="assets/rolldown-runtime-Dx1.js">');
    expect(fragment).toContain('<link rel="stylesheet" crossorigin href="assets/index-C2xQ.css">');
    expect(fragment).not.toMatch(/(src|href)="(\.\/|\/)assets\//);
    expect(fragment).toContain('<div id="root"></div>');
  });

  it('keeps the theme script inline, ahead of the app, and has it set the language the stripped <html> had', () => {
    const script = fragment.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? '';
    expect(script).toContain("localStorage.getItem('werkbuch:theme')");
    expect(script).toContain("document.documentElement.lang = 'de';");
    expect(fragment.indexOf('<script>')).toBeLessThan(fragment.indexOf('<script type="module"'));
  });

  it('leaves out what the page of the host brings: charset, viewport, theme colours and the icon', () => {
    expect(fragment).not.toMatch(/charset|name="viewport"|theme-color|rel="icon"/);
    expect(fragment).toContain('<meta name="color-scheme" content="light dark" />');
  });

  it('turns a fragment into the same fragment', () => {
    expect(toFragment(fragment)).toBe(fragment);
  });

  it('refuses a page without the app script or the root, instead of writing a page that stays blank', () => {
    expect(() => toFragment(BUILT.replace(/<script type="module"[^>]*><\/script>/, ''))).toThrow(/module script/);
    expect(() => toFragment(BUILT.replace('<div id="root"></div>', ''))).toThrow(/root/);
  });
});
