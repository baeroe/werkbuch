import '@fontsource-variable/bricolage-grotesque/opsz.css';
import '@fontsource-variable/figtree';
import { inBrowser } from 'vitepress';
import type { Theme } from 'vitepress';
import DefaultTheme from 'vitepress/theme';
import './style.css';

// pages live under /en and /de below the base (/ locally, DOCS_BASE on GitHub Pages): paths without a language
// (/, /development) land in English. Runs on GitHub Pages' 404 page too.
const base = import.meta.env.BASE_URL;
if (inBrowser && location.pathname.startsWith(base)) {
    const rest = location.pathname.slice(base.length);
    if (!/^(en|de)(\/|$)/.test(rest)) {
        location.replace(`${base}en/${rest}${location.search}${location.hash}`);
    }
}

export default { extends: DefaultTheme } satisfies Theme;
