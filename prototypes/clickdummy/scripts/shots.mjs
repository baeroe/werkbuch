// Screenshots of clickdummy routes at 1440/768/390 in light and dark, with Playwright's own headless Chromium.
// Needs a running dev server (pnpm dev).
//
//   pnpm shots [--base=http://localhost:5173] [--keys=<Playwright keys, comma separated>] [--click=<selector>]
//              [--only=desktop,tablet,mobile] [--light|--dark] [--wait=<ms>] [--fail] <route…>
//
// Writes .shots/<route>/<viewport>-<theme>.png (full page). With --keys or --click the shot shows the viewport,
// where overlays such as dialogs, the palette or toasts appear, and the file name gets a suffix naming the action
// (desktop-light-keys-Meta+K.png), so the plain shot stays. The theme comes from
// localStorage['werkbuch:theme'] before the page loads. --fail sets localStorage['api:fail'] as well: every call of the
// fake API fails, the shots show the error states (file name suffix "-fail"). Prints FINDINGS: console errors and warnings, page errors,
// failed requests, fonts with status "error" (not "unloaded": subsets nobody needs) and sideways page overflow.
// Exits with 1 when there are findings.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const flag = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const routes = args.filter((arg) => !arg.startsWith('--'));
if (routes.length === 0) {
  console.error('usage: pnpm shots [--base=http://localhost:5173] [--keys=Meta+K] [--click=<selector>] [--only=desktop,tablet,mobile] [--light|--dark] [--wait=700] [--fail] <route…>');
  process.exit(2);
}

const base = (flag('base') ?? 'http://localhost:5173').replace(/\/$/, '');
const keys = (flag('keys') ?? '').split(',').map((key) => key.trim()).filter(Boolean);
const click = flag('click');
const wait = Number(flag('wait') ?? 700);
const only = flag('only')?.split(',');
const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
].filter((viewport) => !only || only.includes(viewport.name));
const themes = args.includes('--light') ? ['light'] : args.includes('--dark') ? ['dark'] : ['light', 'dark'];
const fail = args.includes('--fail');
const action = [keys.length > 0 && `keys-${keys.join('_')}`, click && `click-${click}`].filter(Boolean).join('-').replace(/[^\w+?-]+/g, '_');
const outRoot = path.resolve(import.meta.dirname, '..', '.shots');

/** "/projects/WEB?layout=board" → "projects/WEB__layout-board", "/" → "index". */
function routeDir(route) {
  const [pathname, query] = route.split('?');
  const dir = pathname.replace(/^\/+|\/+$/g, '') || 'index';
  return query ? `${dir}__${query.replace(/[&=]/g, '-')}` : dir;
}

const findings = [];
const browser = await chromium.launch();
try {
  for (const route of routes) {
    const dir = path.join(outRoot, routeDir(route));
    mkdirSync(dir, { recursive: true });
    for (const theme of themes) {
      for (const viewport of viewports) {
        const tag = `${route} ${viewport.name}-${theme}`;
        const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, colorScheme: theme });
        await context.addInitScript(
          ({ choice, failing }) => {
            try {
              localStorage.setItem('werkbuch:theme', choice);
              if (failing) localStorage.setItem('api:fail', '1');
            } catch {
              // storage blocked: the page follows the colour scheme
            }
          },
          { choice: theme, failing: fail },
        );
        const page = await context.newPage();
        page.on('console', (message) => {
          if (message.type() === 'error' || message.type() === 'warning') findings.push(`[${tag}] console ${message.type()}: ${message.text()}`);
        });
        page.on('pageerror', (error) => findings.push(`[${tag}] page error: ${error.message}`));
        page.on('requestfailed', (request) => findings.push(`[${tag}] request failed: ${request.url()} (${request.failure()?.errorText})`));
        page.on('response', (response) => {
          if (response.status() >= 400) findings.push(`[${tag}] HTTP ${response.status()}: ${response.url()}`);
        });

        try {
          await page.goto(`${base}${route}`, { waitUntil: 'networkidle' });
        } catch (error) {
          throw new Error(`${base}${route} is not reachable. Is the dev server running (pnpm dev)? ${error.message}`);
        }
        await page.evaluate(async () => {
          await document.fonts.ready;
        });
        if (click) await page.click(click);
        for (const key of keys) {
          await page.keyboard.press(key);
          await page.waitForTimeout(80);
        }
        await page.waitForTimeout(wait);

        const brokenFonts = await page.evaluate(() => [...document.fonts].filter((font) => font.status === 'error').map((font) => `${font.family} ${font.weight}`));
        if (brokenFonts.length > 0) findings.push(`[${tag}] fonts failed: ${[...new Set(brokenFonts)].join(', ')}`);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (overflow > 0) findings.push(`[${tag}] horizontal page overflow: ${overflow}px`);

        const file = path.join(dir, `${viewport.name}-${theme}${fail ? '-fail' : ''}${action ? `-${action}` : ''}.png`);
        await page.screenshot({ path: file, fullPage: !action });
        console.log(path.relative(process.cwd(), file));
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
}

console.log(findings.length > 0 ? `FINDINGS (${findings.length}):\n${findings.join('\n')}` : 'FINDINGS: none');
process.exitCode = findings.length > 0 ? 1 : 0;
