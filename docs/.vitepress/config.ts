import { defineConfig, type DefaultTheme } from 'vitepress';
import llmstxt from 'vitepress-plugin-llms';

// Published on GitHub Pages (.github/workflows/docs.yml sets DOCS_URL). DOCS_BASE is only needed for a copy below a
// sub-path (e.g. https://<user>.github.io/werkbuch/); locally and in DDEV the site lives at /.
const base = process.env.DOCS_BASE ?? '/';
/** Absolute address of the published docs without trailing slash (llms.txt links); unset locally. */
const site = process.env.DOCS_URL?.replace(/\/$/, '');
const description = 'Open, self-hosted project management: work items with your own types, properties and workflows, wikis, views and automations.';

// every page exists in docs/en and docs/de under the same path (tests/Unit/DocsTest.php)
const groups: { title: string; pages: string[] }[] = [
    { title: 'selfhosting', pages: ['setup', 'reverse-proxy', 'operations', 'upgrading', 'backup'] },
    { title: 'guide', pages: ['development', 'keyboard'] },
    { title: 'concepts', pages: ['concepts/permissions', 'concepts/projects', 'concepts/workflows', 'concepts/types-and-properties', 'concepts/work-items', 'concepts/rich-text', 'concepts/wiki', 'concepts/views', 'concepts/templates', 'concepts/automations', 'concepts/notifications', 'search', 'bots', 'api', 'mcp', 'webhooks'] },
];

const sidebar = (prefix: string, t: Record<string, string>): DefaultTheme.SidebarItem[] =>
    groups.map((g) => ({ text: t[g.title], items: g.pages.map((p) => ({ text: t[p], link: `${prefix}/${p}` })) }));

const en: Record<string, string> = {
    selfhosting: 'Self-hosting',
    setup: 'Setup',
    'reverse-proxy': 'Reverse proxy',
    operations: 'Operations',
    upgrading: 'Upgrading',
    backup: 'Backup',
    guide: 'Guide',
    concepts: 'Concepts',
    development: 'Development',
    keyboard: 'Keyboard',
    'concepts/permissions': 'Roles and permissions',
    'concepts/projects': 'Projects',
    'concepts/workflows': 'Workflows',
    'concepts/types-and-properties': 'Types and properties',
    'concepts/work-items': 'Work items',
    'concepts/rich-text': 'Rich text',
    'concepts/wiki': 'Wiki',
    'concepts/views': 'Views',
    'concepts/templates': 'Templates',
    'concepts/automations': 'Automations',
    'concepts/notifications': 'Notifications',
    search: 'Search',
    bots: 'Bots',
    api: 'REST API',
    mcp: 'MCP',
    webhooks: 'Webhooks',
};

const de: Record<string, string> = {
    selfhosting: 'Selbst hosten',
    setup: 'Einrichtung',
    'reverse-proxy': 'Reverse Proxy',
    operations: 'Betrieb',
    upgrading: 'Aktualisieren',
    backup: 'Sicherung',
    guide: 'Anleitung',
    concepts: 'Konzepte',
    development: 'Entwicklung',
    keyboard: 'Tastatur',
    'concepts/permissions': 'Rollen und Rechte',
    'concepts/projects': 'Projekte',
    'concepts/workflows': 'Workflows',
    'concepts/types-and-properties': 'Typen und Properties',
    'concepts/work-items': 'Work Items',
    'concepts/rich-text': 'Rich Text',
    'concepts/wiki': 'Wiki',
    'concepts/views': 'Views',
    'concepts/templates': 'Vorlagen',
    'concepts/automations': 'Automatisierungen',
    'concepts/notifications': 'Benachrichtigungen',
    search: 'Suche',
    bots: 'Bots',
    api: 'REST-API',
    mcp: 'MCP',
    webhooks: 'Webhooks',
};

export default defineConfig({
    base,
    title: 'werkbuch',
    cleanUrls: true,
    lastUpdated: true,
    // docs/history is the project's memory, docs/superpowers holds specs and plans: not part of the site
    srcExclude: ['history/**', 'superpowers/**', 'README.md'],
    // head entries are not rewritten to the base by VitePress
    head: [
        ['link', { rel: 'icon', href: `${base}favicon.svg`, type: 'image/svg+xml' }],
        // the colors of the app (resources/views/app.blade.php), light and dark
        ['meta', { name: 'theme-color', content: '#f5f7f9', media: '(prefers-color-scheme: light)' }],
        ['meta', { name: 'theme-color', content: '#181e28', media: '(prefers-color-scheme: dark)' }],
        ['meta', { property: 'og:title', content: 'werkbuch' }],
        ['meta', { property: 'og:description', content: description }],
    ],
    vite: {
        // agents get the English docs only
        // the plugin puts the base after the domain itself: the origin only
        plugins: [llmstxt({ workDir: 'en', ...(site ? { domain: new URL(site).origin } : {}) })],
        // dev server behind DDEV (https://werkbuch.ddev.site:5174): Vite only answers known hosts
        server: { allowedHosts: ['.ddev.site'] },
    },

    locales: {
        root: {
            label: 'English',
            lang: 'en',
            // English lives under /en like German under /de; links without a prefix are redirected in the theme
            link: '/en/',
            description,
            themeConfig: {
                nav: [{ text: 'Guide', link: '/en/development' }, { text: 'Releases', link: 'https://github.com/baeroe/werkbuch/releases' }],
                sidebar: sidebar('/en', en),
                editLink: { pattern: 'https://github.com/baeroe/werkbuch/edit/main/docs/:path', text: 'Edit this page' },
                footer: { message: 'Released under the MIT License.', copyright: '© 2026 Rafael Haußmann' },
            },
        },
        de: {
            label: 'Deutsch',
            lang: 'de',
            link: '/de/',
            description: 'Offenes, selbst gehostetes Projektmanagement: Work Items mit eigenen Typen, Properties und Workflows, Wikis, Views und Automatisierungen.',
            themeConfig: {
                nav: [{ text: 'Anleitung', link: '/de/development' }, { text: 'Releases', link: 'https://github.com/baeroe/werkbuch/releases' }],
                sidebar: sidebar('/de', de),
                editLink: { pattern: 'https://github.com/baeroe/werkbuch/edit/main/docs/:path', text: 'Seite bearbeiten' },
                footer: { message: 'Veröffentlicht unter der MIT-Lizenz.', copyright: '© 2026 Rafael Haußmann' },
                outline: { label: 'Auf dieser Seite' },
                docFooter: { prev: 'Zurück', next: 'Weiter' },
                lastUpdated: { text: 'Zuletzt aktualisiert' },
                langMenuLabel: 'Sprache wechseln',
                darkModeSwitchLabel: 'Darstellung',
                lightModeSwitchTitle: 'Zu hell wechseln',
                darkModeSwitchTitle: 'Zu dunkel wechseln',
                returnToTopLabel: 'Nach oben',
                sidebarMenuLabel: 'Menü',
                skipToContentLabel: 'Zum Inhalt springen',
                notFound: {
                    title: 'Seite nicht gefunden',
                    quote: 'Diese Seite gibt es nicht (mehr).',
                    linkLabel: 'Zur Startseite',
                    linkText: 'Zur Startseite',
                },
            },
        },
    },

    themeConfig: {
        logo: { src: '/favicon.svg', alt: '' },
        socialLinks: [{ icon: 'github', link: 'https://github.com/baeroe/werkbuch' }],
        search: {
            provider: 'local',
            options: {
                locales: {
                    de: {
                        translations: {
                            button: { buttonText: 'Suchen', buttonAriaLabel: 'Suchen' },
                            modal: {
                                noResultsText: 'Keine Ergebnisse für',
                                resetButtonTitle: 'Suche zurücksetzen',
                                displayDetails: 'Details anzeigen',
                                footer: { selectText: 'auswählen', navigateText: 'navigieren', closeText: 'schließen' },
                            },
                        },
                    },
                },
            },
        },
    },
});
