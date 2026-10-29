/*
 * Seed: the work items of the three projects and the relations between them. The items of the moodboard are in here
 * with their keys, titles and details (WEB-30, -39, -40, -42, -45, -47, -48, -50, -51, -55, APP-5, APP-12, OPS-3,
 * OPS-12); the rest fills the numbers around them. Dates are spread around Wednesday 2026-10-28.
 *
 * A row says what is special about an item; everything else follows from the project (workflow, creator) and the
 * state (resolution, `started_at`, `closed_at`).
 */

import { generateNKeysBetween } from 'fractional-indexing';
import type { Priority, PropertyValue, Relation, RichText, WorkItemRecord } from '@/types';
import { at, day, doc, ol, p, rt, USER_IDS, type UserShort } from './helpers';

type ProjectShort = 'WEB' | 'APP' | 'OPS';
type StateShort = 'backlog' | 'todo' | 'progress' | 'review' | 'approval' | 'pending' | 'done' | 'cancelled';
type TypeShort = 'task' | 'bug' | 'epic' | 'wish';
type LabelShort = 'ux' | 'forms' | 'production' | 'performance' | 'seo' | 'a11y' | 'backend' | 'design';
type ResolutionShort = 'done' | 'wontdo' | 'duplicate' | 'cannot';

const PROJECT_IDS: Record<ProjectShort, string> = { WEB: 'p_web', APP: 'p_app', OPS: 'p_ops' };
const TYPE_IDS: Record<TypeShort, string> = { task: 't_task', bug: 't_bug', epic: 't_epic', wish: 't_wish' };
/** Who creates the items of a project unless a row says otherwise: its lead. */
const DEFAULT_CREATOR: Record<ProjectShort, UserShort> = { WEB: 'ida', APP: 'theo', OPS: 'jonas' };
const OPEN_STARTED = new Set<StateShort>(['progress', 'review', 'approval', 'pending']);

interface Row {
  /** `WEB-47`; the project and the number come from it. */
  key: string;
  type: TypeShort;
  title: string;
  state: StateShort;
  /** Priority; none when omitted. */
  p?: Priority;
  /** Assignee. */
  a?: UserShort;
  /** Labels. */
  l?: LabelShort[];
  /** Start date and due date, 'MM-DD'. */
  start?: string;
  due?: string;
  /** The key of the parent item. */
  parent?: string;
  /** Property values, keyed by property key. */
  v?: Record<string, PropertyValue>;
  by?: UserShort;
  /** 'MM-DD' or 'MM-DD HH:mm', Berlin time. */
  created: string;
  /** When the item entered a started state; defaults to the start date. */
  started?: string;
  /** Required for closed states. */
  closed?: string;
  res?: ResolutionShort;
  desc?: string | RichText;
  updated?: string;
  /** When Auto-Archiv put the item away. */
  archived?: string;
  /** The template that created the item. */
  tpl?: string;
}

/* values */
const NORD = 'opt_nordlicht';
const HAFEN = 'opt_hafenkontor';
const MOOS = 'opt_moos';
const PROD = 'opt_env_prod';
const STAGING = 'opt_env_staging';
const LOCAL = 'opt_env_local';

const web47Steps = doc(
  p('So lässt sich der Fehler nachstellen:'),
  ol('Die Formularseite in Safari (iOS 18) öffnen.', 'Alle Felder ausfüllen und auf „Absenden“ tippen.', 'Im Postfach des Teams liegen zwei identische Mails.'),
);

const rows: Row[] = [
  /* ------------------------------------------------------------------ WEB */
  { key: 'WEB-3', type: 'task', title: 'Projekt-Setup und Repository anlegen', state: 'done', p: 'medium', a: 'sven', l: ['backend'], by: 'jonas', created: '08-24', started: '08-24 10:00', closed: '08-28 16:10' },
  { key: 'WEB-8', type: 'task', title: 'Wireframes für Startseite und Leistungen', state: 'done', p: 'high', a: 'ida', l: ['ux', 'design'], created: '08-31', started: '09-01 09:30', closed: '09-16 17:00', archived: '10-16 03:00' },
  { key: 'WEB-11', type: 'task', title: 'Hosting-Angebote vergleichen', state: 'done', p: 'low', a: 'sven', by: 'mara', created: '09-04', closed: '09-11 12:30' },
  { key: 'WEB-14', type: 'bug', title: 'Ladefehler im alten Prototyp', state: 'cancelled', res: 'cannot', p: 'low', a: 'sven', v: { environment: LOCAL }, created: '09-07', closed: '09-09 10:15', archived: '10-09 03:00' },
  { key: 'WEB-17', type: 'task', title: 'Bildmaterial sichten und sortieren', state: 'done', p: 'medium', a: 'lene', l: ['design'], v: { customer: NORD }, created: '09-14', started: '09-15 09:00', closed: '10-02 15:45' },
  { key: 'WEB-21', type: 'task', title: 'Content-Inventur der Altseite', state: 'done', p: 'medium', a: 'ida', created: '09-21', started: '09-22 09:00', closed: '10-02 11:20' },
  { key: 'WEB-24', type: 'task', title: 'Schriften lokal einbinden', state: 'done', p: 'low', a: 'jonas', l: ['performance'], v: { effort: 2 }, created: '09-28', started: '10-05 10:00', closed: '10-06 17:05' },
  { key: 'WEB-27', type: 'task', title: 'Redaktionsplan mit dem Kunden abstimmen', state: 'done', p: 'medium', a: 'ida', v: { customer: NORD }, created: '09-30', closed: '10-08 14:00' },
  { key: 'WEB-29', type: 'task', title: 'Staging-Umgebung einrichten', state: 'done', p: 'high', a: 'jonas', l: ['backend'], v: { effort: 5 }, created: '09-30', started: '10-01 09:00', closed: '10-09 18:30' },
  {
    key: 'WEB-30',
    type: 'epic',
    title: 'Relaunch Phase 1',
    state: 'progress',
    start: '10-01',
    due: '11-15',
    v: { target_quarter: 'opt_q4_2026' },
    created: '10-01 09:00',
    started: '10-01 10:00',
    desc: 'Phase 1 umfasst Struktur, Gestaltung, Startseite und den Umzug auf den neuen Server. Danach folgen die Leistungsseiten und das Journal.',
  },
  { key: 'WEB-31', type: 'task', title: 'Sitemap und Seitenstruktur abstimmen', state: 'done', p: 'high', a: 'ida', l: ['ux'], parent: 'WEB-30', v: { customer: NORD }, created: '10-01 09:20', started: '10-02 09:00', closed: '10-06 16:00' },
  { key: 'WEB-32', type: 'task', title: 'Rechtstexte beim Kunden anfragen', state: 'done', p: 'medium', a: 'ida', created: '10-02', closed: '10-08 10:30' },
  { key: 'WEB-33', type: 'task', title: 'Designsystem: Farben und Typografie festlegen', state: 'done', p: 'medium', a: 'lene', l: ['design'], parent: 'WEB-30', created: '10-02', started: '10-02 14:00', closed: '10-09 12:15' },
  { key: 'WEB-34', type: 'task', title: 'Wartung KW 41', state: 'done', p: 'medium', a: 'jonas', l: ['backend'], by: 'automation', tpl: 'tpl_web_maintenance', due: '10-07', created: '10-05 09:00', started: '10-06 09:00', closed: '10-06 17:40' },
  { key: 'WEB-35', type: 'task', title: 'Navigation: Desktop-Variante bauen', state: 'done', p: 'high', a: 'ida', l: ['ux'], parent: 'WEB-30', v: { effort: 6.5 }, created: '10-06', started: '10-08 09:00', closed: '10-14 15:30' },
  { key: 'WEB-36', type: 'task', title: 'Alte Blog-Beiträge migrieren', state: 'cancelled', res: 'wontdo', p: 'low', a: 'jonas', parent: 'WEB-30', created: '10-06', closed: '10-12 11:00' },
  { key: 'WEB-37', type: 'task', title: 'Newsletter-Anmeldung anbinden', state: 'backlog', p: 'low', a: 'sven', l: ['forms'], by: 'mara', created: '10-07' },
  { key: 'WEB-38', type: 'task', title: 'Wartung KW 42', state: 'done', p: 'medium', a: 'jonas', l: ['backend'], by: 'automation', tpl: 'tpl_web_maintenance', due: '10-14', created: '10-12 09:00', started: '10-13 09:00', closed: '10-13 16:20' },
  {
    key: 'WEB-39',
    type: 'task',
    title: 'Domain auf neuen Server umziehen',
    state: 'done',
    p: 'medium',
    a: 'jonas',
    l: ['backend'],
    start: '10-19',
    due: '10-26',
    parent: 'WEB-30',
    v: { effort: 4 },
    created: '10-13',
    started: '10-19 10:00',
    closed: '10-27 16:20',
  },
  { key: 'WEB-40', type: 'bug', title: 'Favicon fehlt im Safari', state: 'done', p: 'low', a: 'lene', parent: 'WEB-30', by: 'mara', v: { environment: PROD, browser: 'Safari 17 (macOS)' }, created: '10-14', closed: '10-23 14:10' },
  {
    key: 'WEB-41',
    type: 'task',
    title: 'Impressum aktualisieren',
    state: 'progress',
    p: 'high',
    a: 'ida',
    start: '10-22',
    due: '10-27',
    created: '10-14',
    started: '10-22 09:45',
    desc: 'Die Angaben zur Geschäftsführung und die Registernummer sind veraltet. Die neuen Daten stehen noch aus.',
    updated: '10-24 12:00',
  },
  {
    key: 'WEB-42',
    type: 'task',
    title: 'Startseite: Hero und Teaser bauen',
    state: 'progress',
    p: 'high',
    a: 'ida',
    start: '10-26',
    due: '10-30',
    parent: 'WEB-30',
    v: { customer: NORD, effort: 8 },
    created: '10-15 10:05',
    started: '10-26 10:00',
    desc: 'Oben der Hero mit Claim und Bild, darunter drei Teaser für Leistungen, Referenzen und Journal. Der Entwurf hängt als Datei an.',
  },
  { key: 'WEB-43', type: 'task', title: 'Footer mit Adresse und Öffnungszeiten', state: 'todo', p: 'medium', a: 'lene', l: ['design'], due: '11-04', parent: 'WEB-30', created: '10-16' },
  {
    key: 'WEB-44',
    type: 'task',
    title: 'Alt-Texte für Bilder ergänzen',
    state: 'todo',
    p: 'medium',
    a: 'kira',
    l: ['a11y'],
    due: '11-03',
    by: 'mara',
    created: '10-16',
    desc: 'Alle Bilder der Startseite und der Leistungsseiten brauchen aussagekräftige Alt-Texte.',
  },
  {
    key: 'WEB-45',
    type: 'task',
    title: 'Texte der Leistungsseiten',
    state: 'pending',
    p: 'medium',
    v: { customer: NORD },
    created: '10-17',
    started: '10-20 09:00',
    desc: 'Wartet auf Zulieferung der Texte durch Studio Nordlicht. Die Gliederung hängt als Datei an.',
    updated: '10-27 15:00',
  },
  { key: 'WEB-46', type: 'task', title: 'Wartung KW 43', state: 'done', p: 'medium', a: 'jonas', l: ['backend'], by: 'automation', tpl: 'tpl_web_maintenance', due: '10-21', created: '10-19 09:00', started: '10-20 09:00', closed: '10-20 15:00' },
  {
    key: 'WEB-47',
    type: 'bug',
    title: 'Kontaktformular sendet doppelt',
    state: 'progress',
    p: 'urgent',
    a: 'jonas',
    l: ['forms', 'production'],
    start: '10-27',
    due: '10-31',
    v: { customer: NORD, effort: 3.5, environment: PROD, browser: 'Safari 18 (iOS)', steps: web47Steps },
    created: '10-20 11:30',
    started: '10-27 09:15',
    desc: 'Beim Absenden über Safari kommen zwei Mails an. @mara kannst du prüfen, ob das mit WEB-42 zusammenhängt?',
    updated: '10-27 10:20',
  },
  { key: 'WEB-48', type: 'task', title: 'Navigation für Mobilgeräte überarbeiten', state: 'todo', p: 'high', a: 'lene', l: ['ux'], parent: 'WEB-30', created: '10-21', desc: 'Aktuell läuft das Menü auf Smartphones über einen Burger-Button. Zu prüfen ist eine Tab-Leiste am unteren Rand.', updated: '10-27 16:30' },
  { key: 'WEB-49', type: 'task', title: 'Leistungsseiten: Layout-Vorlage', state: 'backlog', p: 'medium', parent: 'WEB-30', v: { customer: NORD }, created: '10-22' },
  { key: 'WEB-50', type: 'task', title: 'Fehlerseite 404 gestalten', state: 'todo', p: 'medium', created: '10-22' },
  { key: 'WEB-51', type: 'task', title: 'Cookie-Banner auf Consent v2 umstellen', state: 'backlog', p: 'low', created: '10-23' },
  { key: 'WEB-52', type: 'task', title: 'Wartung KW 44', state: 'progress', p: 'medium', a: 'jonas', l: ['backend'], by: 'automation', tpl: 'tpl_web_maintenance', due: '10-28', created: '10-26 09:00', started: '10-27 09:00' },
  { key: 'WEB-53', type: 'task', title: 'robots.txt und Sitemap.xml ergänzen', state: 'todo', p: 'low', a: 'kira', l: ['seo'], due: '11-01', by: 'mara', created: '10-26', desc: 'Die Sitemap aus den Seiten erzeugen und in der robots.txt verlinken.' },
  { key: 'WEB-54', type: 'task', title: 'Browser-Test Formulare (Safari, Firefox)', state: 'todo', p: 'medium', a: 'lene', l: ['forms'], created: '10-26' },
  { key: 'WEB-55', type: 'task', title: 'Bildformate auf AVIF prüfen', state: 'backlog', created: '10-27' },
  {
    key: 'WEB-56',
    type: 'task',
    title: 'Lighthouse-Budget in der CI festlegen',
    state: 'backlog',
    p: 'low',
    a: 'mara',
    l: ['performance'],
    created: '10-27',
    desc: 'Budget: Largest Contentful Paint unter 2,5 s auf der Startseite und weniger als 1 MB Gesamtgewicht. Die CI soll bei einer Überschreitung fehlschlagen.',
  },

  /* ------------------------------------------------------------------ APP */
  { key: 'APP-1', type: 'task', title: 'Projektstart und Zugänge klären', state: 'done', p: 'medium', a: 'theo', created: '07-06', closed: '07-10 15:00' },
  { key: 'APP-2', type: 'task', title: 'API-Zugang beim Kunden beantragen', state: 'done', p: 'high', a: 'mara', by: 'mara', v: { customer: HAFEN }, created: '07-08', started: '07-09 09:00', closed: '07-24 11:00' },
  { key: 'APP-3', type: 'task', title: 'App-Icon und Splashscreen', state: 'done', p: 'low', a: 'lene', l: ['design'], created: '08-03', started: '08-04 09:00', closed: '08-14 16:30', archived: '09-13 03:00' },
  { key: 'APP-4', type: 'task', title: 'Monatsbericht September 2026', state: 'done', p: 'medium', a: 'theo', by: 'automation', tpl: 'tpl_app_report', created: '09-07 09:00', started: '09-08 09:00', closed: '09-18 12:00' },
  {
    key: 'APP-5',
    type: 'epic',
    title: 'Kunden-App 2.0 Beta',
    state: 'progress',
    start: '10-20',
    due: '12-20',
    v: { target_quarter: 'opt_q4_2026', customer: HAFEN },
    created: '10-02',
    started: '10-20 09:00',
    desc: 'Zweite Version der Kunden-App mit Biometrie, Push-Mitteilungen, Offline-Modus und neuem Onboarding. Die Beta läuft bis Mitte Dezember.',
  },
  { key: 'APP-6', type: 'task', title: 'Login mit Biometrie', state: 'done', p: 'high', a: 'jonas', parent: 'APP-5', v: { effort: 10 }, created: '10-06', started: '10-12 09:00', closed: '10-22 15:40' },
  { key: 'APP-7', type: 'task', title: 'Onboarding-Screens überarbeiten', state: 'done', p: 'medium', a: 'lene', l: ['ux'], parent: 'APP-5', created: '10-06', started: '10-14 09:00', closed: '10-24 13:20' },
  { key: 'APP-8', type: 'task', title: 'Monatsbericht Oktober 2026', state: 'progress', p: 'medium', a: 'theo', by: 'automation', tpl: 'tpl_app_report', created: '10-05 09:00', started: '10-26 09:00' },
  { key: 'APP-9', type: 'task', title: 'Push-Benachrichtigungen: Einstellungen', state: 'review', p: 'medium', a: 'lene', parent: 'APP-5', v: { effort: 6 }, created: '10-08', started: '10-21 09:00', desc: 'Nutzerinnen und Nutzer sollen Push-Mitteilungen je Thema ein- und ausschalten können.' },
  {
    key: 'APP-10',
    type: 'bug',
    title: 'Absturz beim Öffnen der Push-Einstellungen',
    state: 'progress',
    p: 'urgent',
    a: 'jonas',
    l: ['production'],
    parent: 'APP-5',
    v: { customer: HAFEN, effort: 3, environment: PROD, browser: 'Android 14' },
    created: '10-22',
    started: '10-27 11:00',
    start: '10-27',
    due: '10-30',
    desc: 'Auf Android 14 stürzt die App ab, sobald die Push-Einstellungen aufgehen. Zusammenhang mit APP-9 möglich.',
  },
  { key: 'APP-11', type: 'task', title: 'Offline-Modus für die Bestellliste', state: 'todo', p: 'medium', a: 'jonas', parent: 'APP-5', v: { customer: HAFEN }, created: '10-12' },
  {
    key: 'APP-12',
    type: 'task',
    title: 'Kontaktdaten im Profil bearbeiten',
    state: 'review',
    p: 'medium',
    a: 'lene',
    parent: 'APP-5',
    created: '10-14',
    started: '10-23 09:00',
    desc: 'Name, Telefonnummer und Adresse im Profil bearbeiten. Eine geänderte E-Mail-Adresse braucht eine Bestätigung.',
    updated: '10-27 17:15',
  },
  { key: 'APP-13', type: 'task', title: 'Dark Mode für die App', state: 'backlog', p: 'low', parent: 'APP-5', created: '10-14' },
  { key: 'APP-14', type: 'task', title: 'Suche in der Produktliste', state: 'todo', p: 'medium', a: 'mara', parent: 'APP-5', created: '10-15' },
  {
    key: 'APP-15',
    type: 'wish',
    title: 'Bestellhistorie als PDF exportieren',
    state: 'approval',
    p: 'medium',
    a: 'theo',
    by: 'mara',
    v: { customer: HAFEN, ticket_url: 'https://tickets.hafenkontor.example.com/HK-2291', approved: false, reviewer: USER_IDS.theo },
    created: '10-16',
    started: '10-24 10:00',
    desc: 'Hafenkontor möchte die Bestellhistorie als PDF exportieren, mit Datum, Positionen und Summen.',
  },
  { key: 'APP-16', type: 'task', title: 'Release-Notes für die Beta schreiben', state: 'todo', p: 'medium', a: 'theo', due: '11-03', created: '10-19' },
  {
    key: 'APP-17',
    type: 'bug',
    title: 'Falsche Summe im Warenkorb mit Rabattcode',
    state: 'progress',
    p: 'high',
    a: 'jonas',
    l: ['production'],
    start: '10-27',
    due: '10-29',
    v: { customer: HAFEN, effort: 2.5, environment: PROD },
    created: '10-20',
    started: '10-27 13:00',
    desc: 'Mit Rabattcode zeigt der Warenkorb die Zwischensumme um den Rabatt zu hoch an.',
  },
  { key: 'APP-18', type: 'task', title: 'TestFlight-Gruppe für Kunden einrichten', state: 'review', p: 'medium', a: 'mara', due: '10-28', created: '10-21', started: '10-26 09:00' },
  { key: 'APP-19', type: 'wish', title: 'Wunschliste teilen', state: 'backlog', p: 'low', by: 'mara', v: { customer: MOOS, approved: false, reviewer: USER_IDS.theo }, created: '10-22' },
  { key: 'APP-21', type: 'bug', title: 'Rabattcode wird doppelt abgezogen', state: 'cancelled', res: 'duplicate', p: 'high', a: 'jonas', v: { environment: PROD, customer: HAFEN }, created: '10-23', closed: '10-23 17:00' },
  { key: 'APP-22', type: 'bug', title: 'Tastatur verdeckt Eingabefeld auf kleinen Geräten', state: 'backlog', p: 'medium', v: { environment: STAGING, browser: 'iPhone SE' }, created: '10-26' },
  { key: 'APP-24', type: 'task', title: 'Feedback der Beta-Tester sammeln', state: 'backlog', p: 'medium', a: 'mara', created: '10-27 10:00', desc: 'Rückmeldungen der Beta-Gruppe sammeln, nach Themen ordnen und mit Theo besprechen.' },

  /* ------------------------------------------------------------------ OPS */
  {
    key: 'OPS-3',
    type: 'epic',
    title: 'Server-Migration',
    state: 'progress',
    start: '09-01',
    due: '10-31',
    v: { target_quarter: 'opt_q4_2026' },
    created: '08-28',
    started: '09-01 09:00',
    desc: 'Umzug aller Dienste auf die neuen Server. Danach werden die alten Server abgeschaltet, sobald Mail-Versand und Monitoring laufen.',
  },
  { key: 'OPS-4', type: 'task', title: 'Bestandsaufnahme der alten Server', state: 'done', p: 'medium', a: 'jonas', parent: 'OPS-3', created: '08-28', started: '08-29 09:00', closed: '09-04 16:00' },
  { key: 'OPS-5', type: 'task', title: 'Neue Server bestellen und einrichten', state: 'done', p: 'high', a: 'jonas', l: ['backend'], parent: 'OPS-3', created: '08-28', started: '09-02 09:00', closed: '09-11 17:30' },
  { key: 'OPS-6', type: 'task', title: 'Docker-Compose-Stack aufsetzen', state: 'done', p: 'high', a: 'jonas', parent: 'OPS-3', v: { effort: 12 }, created: '09-02', started: '09-08 09:00', closed: '09-18 14:00' },
  { key: 'OPS-7', type: 'task', title: 'Datenbank-Replikation einrichten', state: 'done', p: 'high', a: 'mara', parent: 'OPS-3', created: '09-02', started: '09-15 09:00', closed: '09-25 11:45' },
  { key: 'OPS-8', type: 'task', title: 'Backups auf neuen Speicher umstellen', state: 'done', p: 'medium', a: 'jonas', parent: 'OPS-3', created: '09-09', started: '09-24 09:00', closed: '10-01 16:20' },
  { key: 'OPS-9', type: 'bug', title: 'Cronjobs laufen nach dem Umzug doppelt', state: 'done', p: 'high', a: 'jonas', l: ['production'], parent: 'OPS-3', v: { environment: PROD, effort: 1.5 }, created: '10-02', closed: '10-07 10:10' },
  { key: 'OPS-10', type: 'task', title: 'TLS-Zertifikate übertragen', state: 'done', p: 'medium', a: 'kira', parent: 'OPS-3', created: '10-02', started: '10-12 09:00', closed: '10-13 13:00' },
  { key: 'OPS-11', type: 'task', title: 'DNS-Einträge umstellen', state: 'done', p: 'high', a: 'mara', parent: 'OPS-3', created: '10-08', started: '10-20 09:00', closed: '10-27 14:00' },
  {
    key: 'OPS-12',
    type: 'task',
    title: 'Mail-Limits am Server erhöhen',
    state: 'todo',
    p: 'high',
    a: 'jonas',
    due: '10-30',
    parent: 'OPS-3',
    by: 'mara',
    v: { effort: 1.5 },
    created: '10-20 14:00',
    desc: 'Das Limit liegt bei 100 Mails pro Stunde. Formularmails und der Wochenreport brauchen mehr. Die Datei mit der aktuellen Konfiguration hängt an.',
    updated: '10-26 16:30',
  },
  { key: 'OPS-13', type: 'task', title: 'Monitoring auf die neuen Hosts umziehen', state: 'done', p: 'medium', a: 'kira', parent: 'OPS-3', created: '10-14', started: '10-16 09:00', closed: '10-21 12:30' },
  { key: 'OPS-14', type: 'task', title: 'Backup-Restore testen', state: 'backlog', p: 'medium', a: 'mara', created: '10-22', desc: 'Einmal komplett aus dem Backup wiederherstellen und die Dauer messen.' },
  { key: 'OPS-15', type: 'task', title: 'Zertifikate automatisch erneuern (ACME)', state: 'todo', p: 'low', a: 'kira', l: ['backend'], created: '10-26', desc: 'Zertifikate sollen per ACME ohne manuelles Einspielen erneuert werden.' },
];

/* ------------------------------------------------------------------ the builder */

function parseKey(key: string): { project: ProjectShort; number: number } {
  const [project, number] = key.split('-');
  return { project: project as ProjectShort, number: Number(number) };
}

const pad = (value: number) => String(value).padStart(2, '0');

/** The ids of the seed items: `wi_web_47`. */
export const itemId = (key: string): string => `wi_${key.toLowerCase().replace('-', '_')}`;

function build(row: Row, rank: string): WorkItemRecord {
  const { project, number } = parseKey(row.key);
  const closed = row.state === 'done' || row.state === 'cancelled';
  if (closed && !row.closed) throw new Error(`${row.key} is closed and needs a "closed" time`);

  const created = row.created.includes(' ') ? row.created : `${row.created} 09:${pad((number * 7) % 50 + 5)}`;
  const stateId = `${project === 'APP' ? 'app' : 'std'}_${row.state}`;
  const startedAt = row.started
    ? at(row.started.includes(' ') ? row.started : `${row.started} 10:00`)
    : OPEN_STARTED.has(row.state)
      ? at(`${row.start ?? row.created.slice(0, 5)} 10:00`)
      : null;
  const closedAt = row.closed ? at(row.closed) : null;
  const updatedAt = row.updated ? at(row.updated) : [at(created), startedAt, closedAt].filter((value): value is string => value !== null).sort().at(-1)!;
  const resolution = closed ? `res_${row.res ?? (row.state === 'done' ? 'done' : 'wontdo')}` : null;

  return {
    id: itemId(row.key),
    project_id: PROJECT_IDS[project],
    number,
    key: row.key,
    type_id: TYPE_IDS[row.type],
    title: row.title,
    description: row.desc === undefined ? null : typeof row.desc === 'string' ? rt(row.desc) : row.desc,
    description_version: 1,
    state_id: stateId,
    resolution_id: resolution,
    assignee_id: row.a ? USER_IDS[row.a] : null,
    priority: row.p ?? 'none',
    label_ids: (row.l ?? []).map((label) => `lb_${label}`),
    start_date: row.start ? day(row.start) : null,
    due_date: row.due ? day(row.due) : null,
    parent_id: row.parent ? itemId(row.parent) : null,
    rank,
    values: row.v ?? {},
    created_by: USER_IDS[row.by ?? DEFAULT_CREATOR[project]],
    created_at: at(created),
    updated_at: updatedAt,
    started_at: startedAt,
    closed_at: closedAt,
    archived_at: row.archived ? at(row.archived) : null,
    template_id: row.tpl ?? null,
    subscriber_ids: [],
  };
}

/** All seed items; the manual order of each project follows the item numbers. */
export function buildItems(): WorkItemRecord[] {
  const items: WorkItemRecord[] = [];
  for (const project of ['WEB', 'APP', 'OPS'] as const) {
    const projectRows = rows.filter((row) => parseKey(row.key).project === project).sort((a, b) => parseKey(a.key).number - parseKey(b.key).number);
    const ranks = generateNKeysBetween(null, null, projectRows.length);
    projectRows.forEach((row, index) => items.push(build(row, ranks[index])));
  }
  return items;
}

/* ------------------------------------------------------------------ relations */

const relation = (id: string, type: string, source: string, target: string): Relation => ({
  id,
  type_id: type,
  source_id: itemId(source),
  target_id: itemId(target),
});

export const relations: Relation[] = [
  // the demo's blocker: the mail limit holds up the contact form fix
  relation('rel_1', 'rt_blocks', 'OPS-12', 'WEB-47'),
  relation('rel_2', 'rt_tests', 'WEB-54', 'WEB-47'),
  relation('rel_3', 'rt_blocks', 'WEB-45', 'WEB-49'),
  relation('rel_4', 'rt_blocks', 'APP-16', 'APP-18'),
  relation('rel_5', 'rt_duplicates', 'APP-21', 'APP-17'),
  relation('rel_6', 'rt_relates', 'WEB-41', 'WEB-32'),
  relation('rel_7', 'rt_relates', 'APP-9', 'APP-10'),
  relation('rel_8', 'rt_relates', 'OPS-14', 'OPS-8'),
];
