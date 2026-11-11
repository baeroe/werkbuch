/** The words of the landing page's own sections, in both languages. The rest comes from the front matter of {en,de}/index.md. */
export type Lang = 'en' | 'de';

export type Card = { key: string; tone: 'sky' | 'ochre' | 'moss'; type: string; title: string; state: string; stateShape: 'half' | 'circle' | 'check'; who: string };

const en = {
    desk: {
        query: 'form',
        palettePlaceholder: 'Search or run a command …',
        results: [
            { key: 'WEB-47', title: 'Contact form sends twice' },
            { key: 'WEB-54', title: 'Browser test of the forms (Safari, Firefox)' },
            { key: 'WEB-40', title: 'Favicon missing in Safari' },
        ],
        cards: [
            { key: 'WEB-47', tone: 'ochre', type: 'Bug', title: 'Contact form sends twice', state: 'In progress', stateShape: 'half', who: 'ML' },
            { key: 'WEB-30', tone: 'moss', type: 'Epic', title: 'Relaunch phase 1', state: '7 of 12 done', stateShape: 'circle', who: 'JF' },
            { key: 'WEB-42', tone: 'sky', type: 'Task', title: 'Home page: build the hero and teasers', state: 'Done', stateShape: 'check', who: 'LV' },
        ] as Card[],
        replay: 'Play the search again',
    },
    keys: {
        heading: 'Try it with your keyboard',
        lead: 'werkbuch is built for the keyboard. This list works like the real one: move with j and k, select with x, change the status with s, open with Enter.',
        listLabel: 'Work items to try the keys on',
        hint: 'Click a key or press it while the list is on screen.',
        legend: { j: 'down', k: 'up', x: 'select', s: 'status', enter: 'open' },
        opened: (key: string) => `${key} opens on its own page.`,
        selected: (n: number) => (n === 1 ? '1 selected' : `${n} selected`),
        moved: (key: string, title: string) => `${key} ${title}`,
        status: (key: string, state: string) => `${key} is now ${state}`,
        states: ['Todo', 'In progress', 'Done'],
        rows: [
            { key: 'WEB-41', title: 'Update the legal notice' },
            { key: 'WEB-44', title: 'Add alt texts to the images' },
            { key: 'WEB-47', title: 'Contact form sends twice' },
            { key: 'WEB-50', title: 'Design the 404 error page' },
            { key: 'WEB-53', title: 'Add robots.txt and sitemap.xml' },
        ],
        more: 'All shortcuts',
    },
    host: {
        heading: 'On your server in three steps',
        lead: 'One Docker Compose stack: the werkbuch image, MariaDB and Meilisearch behind a single port. Your data stays where you put it.',
        steps: [
            { title: 'Paste the compose file', text: 'Into Dockge, Portainer or a compose.yaml on your server.' },
            { title: 'Set five values', text: 'The address, the first admin and two passwords.' },
            { title: 'Start it', text: 'werkbuch migrates, builds its search index and says ready.' },
        ],
        command: 'docker compose up -d',
        copy: 'Copy',
        copied: 'Copied',
        more: 'Read the setup',
    },
};

const de: typeof en = {
    desk: {
        query: 'formular',
        palettePlaceholder: 'Suchen oder Befehl ausführen …',
        results: [
            { key: 'WEB-47', title: 'Kontaktformular sendet doppelt' },
            { key: 'WEB-54', title: 'Browser-Test Formulare (Safari, Firefox)' },
            { key: 'WEB-40', title: 'Favicon fehlt im Safari' },
        ],
        cards: [
            { key: 'WEB-47', tone: 'ochre', type: 'Bug', title: 'Kontaktformular sendet doppelt', state: 'In Progress', stateShape: 'half', who: 'ML' },
            { key: 'WEB-30', tone: 'moss', type: 'Epic', title: 'Relaunch Phase 1', state: '7 von 12 erledigt', stateShape: 'circle', who: 'JF' },
            { key: 'WEB-42', tone: 'sky', type: 'Task', title: 'Startseite: Hero und Teaser bauen', state: 'Done', stateShape: 'check', who: 'LV' },
        ],
        replay: 'Suche noch einmal abspielen',
    },
    keys: {
        heading: 'Probier es mit der Tastatur',
        lead: 'werkbuch ist für die Tastatur gebaut. Diese Liste reagiert wie die echte: j und k bewegen, x wählt aus, s ändert den Status, Enter öffnet.',
        listLabel: 'Work Items zum Ausprobieren der Tasten',
        hint: 'Klick eine Taste oder drück sie, solange die Liste zu sehen ist.',
        legend: { j: 'runter', k: 'hoch', x: 'auswählen', s: 'Status', enter: 'öffnen' },
        opened: (key) => `${key} öffnet sich auf seiner Seite.`,
        selected: (n) => `${n} ausgewählt`,
        moved: (key, title) => `${key} ${title}`,
        status: (key, state) => `${key} ist jetzt ${state}`,
        states: ['Todo', 'In Progress', 'Done'],
        rows: [
            { key: 'WEB-41', title: 'Impressum aktualisieren' },
            { key: 'WEB-44', title: 'Alt-Texte für Bilder ergänzen' },
            { key: 'WEB-47', title: 'Kontaktformular sendet doppelt' },
            { key: 'WEB-50', title: 'Fehlerseite 404 gestalten' },
            { key: 'WEB-53', title: 'robots.txt und Sitemap.xml ergänzen' },
        ],
        more: 'Alle Tastenkürzel',
    },
    host: {
        heading: 'In drei Schritten auf deinem Server',
        lead: 'Ein Docker-Compose-Stack: das Image von werkbuch, MariaDB und Meilisearch hinter einem Port. Deine Daten bleiben, wo du sie hinlegst.',
        steps: [
            { title: 'Compose-Datei einfügen', text: 'In Dockge, Portainer oder als compose.yaml auf deinem Server.' },
            { title: 'Fünf Werte setzen', text: 'Die Adresse, das erste Konto und zwei Passwörter.' },
            { title: 'Starten', text: 'werkbuch migriert, baut den Suchindex und meldet sich bereit.' },
        ],
        command: 'docker compose up -d',
        copy: 'Kopieren',
        copied: 'Kopiert',
        more: 'Zum Setup',
    },
};

export const copy = { en, de };
