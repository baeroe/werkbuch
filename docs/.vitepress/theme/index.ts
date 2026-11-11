import '@fontsource-variable/bricolage-grotesque/opsz.css';
import '@fontsource-variable/figtree';
import { inBrowser } from 'vitepress';
import type { Theme } from 'vitepress';
import DefaultTheme from 'vitepress/theme';
import { h } from 'vue';
import HeroDesk from './components/HeroDesk.vue';
import KeyPlay from './components/KeyPlay.vue';
import SelfHost from './components/SelfHost.vue';
import './style.css';
import './home.css';

// pages live under /en and /de below the base (/ locally, DOCS_BASE on GitHub Pages): paths without a language
// (/, /development) land in English. Runs on GitHub Pages' 404 page too.
const base = import.meta.env.BASE_URL;
if (inBrowser && location.pathname.startsWith(base)) {
    const rest = location.pathname.slice(base.length);
    if (!/^(en|de)(\/|$)/.test(rest)) {
        location.replace(`${base}en/${rest}${location.search}${location.hash}`);
    }
}

// the landing page: the hero image of the front matter lies on the desk with its cards, the keys follow the features;
// <SelfHost /> stands in the Markdown of {en,de}/index.md
export default {
    extends: DefaultTheme,
    Layout: () => h(DefaultTheme.Layout, null, { 'home-hero-image': () => h(HeroDesk), 'home-features-after': () => h(KeyPlay) }),
    enhanceApp({ app }) {
        app.component('SelfHost', SelfHost);
    },
} satisfies Theme;
