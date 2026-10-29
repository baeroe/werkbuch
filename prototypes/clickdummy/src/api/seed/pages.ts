/*
 * Seed: the wiki. WEB has 12 pages in up to three levels (with "Kontaktformular – Technik" and "Seitenstruktur"), APP
 * has 4 and OPS 3. "Seitenstruktur" has three versions and reports a conflict on the first save.
 */

import type { Page, PageVersion, RichText } from '@/types';
import { at, code, doc, h, ol, p, ul, USER_IDS, type UserShort } from './helpers';

interface PageRow {
  id: string;
  project: string;
  parent?: string;
  /** Fractional-indexing key among the siblings. */
  rank: string;
  emoji: string;
  title: string;
  content: RichText;
  by: UserShort;
  created: string;
  updated?: string;
  version?: number;
  updatedBy?: UserShort;
}

const rows: PageRow[] = [
  /* ----------------------------------------------------------------------- WEB */
  {
    id: 'pg_web_handbook',
    project: 'p_web',
    rank: 'a0',
    emoji: '📘',
    title: 'Projekt-Handbuch',
    by: 'ida',
    created: '09-14 10:00',
    content: doc(
      p('Dieses Handbuch bündelt, was das Team für den Website-Relaunch braucht: Struktur, Gestaltung, Technik und Absprachen.'),
      h(2, 'Inhalt'),
      ul('Seitenstruktur: welche Seiten es gibt und wie sie zusammenhängen', 'Designsystem: Farben, Schrift und Abstände', 'Redaktion: Tonalität und Ablauf der Texte', 'Technik: Formular, Hosting und Performance'),
      p('Offene Fragen sammeln wir als Items im Epic WEB-30.'),
    ),
  },
  {
    id: 'pg_web_structure',
    project: 'p_web',
    parent: 'pg_web_handbook',
    rank: 'a0',
    emoji: '🧭',
    title: 'Seitenstruktur',
    by: 'ida',
    created: '10-02 14:00',
    updated: '10-14 11:00',
    version: 3,
    content: doc(
      h(2, 'Navigation'),
      ul('Start', 'Leistungen (Beratung, Umsetzung, Betrieb)', 'Referenzen', 'Journal', 'Über uns', 'Anfahrt', 'Impressum und Datenschutz'),
      h(2, 'Stand'),
      p('Abgestimmt mit Studio Nordlicht am 6.10. Offen ist die Reihenfolge der Referenzen.'),
      p('Die Navigation für Mobilgeräte folgt in WEB-48.'),
    ),
  },
  {
    id: 'pg_web_design',
    project: 'p_web',
    parent: 'pg_web_handbook',
    rank: 'a1',
    emoji: '🎨',
    title: 'Designsystem',
    by: 'lene',
    created: '10-02 15:30',
    content: doc(
      p('Das Designsystem hält Farben, Schrift und Abstände fest, damit Seiten und Bausteine zusammenpassen.'),
      ul('Die Werte liegen als CSS-Variablen vor', 'Bausteine werden einmal gebaut und wiederverwendet', 'Kontraste folgen WCAG 2.2 AA'),
    ),
  },
  {
    id: 'pg_web_typography',
    project: 'p_web',
    parent: 'pg_web_design',
    rank: 'a0',
    emoji: '🔤',
    title: 'Typografie und Farben',
    by: 'lene',
    created: '10-09 11:00',
    content: doc(
      h(2, 'Schrift'),
      p('Überschriften in einer kräftigen Grotesk, Fließtext in einer ruhigen Sans.'),
      h(2, 'Farben'),
      ul('Tiefblau für Akzente und Links', 'Warmes Grau für Flächen', 'Ein gedecktes Gelb nur für Markierungen'),
    ),
  },
  {
    id: 'pg_web_editorial',
    project: 'p_web',
    parent: 'pg_web_handbook',
    rank: 'a2',
    emoji: '✍️',
    title: 'Redaktion und Tonalität',
    by: 'ida',
    created: '10-03 09:40',
    content: doc(
      p('Wir schreiben direkt und freundlich, ohne Fachjargon. Sätze bleiben kurz.'),
      h(2, 'Ablauf'),
      ol('Der Kunde liefert den Rohtext.', 'Die Redaktion kürzt und gliedert.', 'Der Kunde gibt frei.', 'Die Texte gehen ins CMS.'),
    ),
  },
  {
    id: 'pg_web_tech',
    project: 'p_web',
    rank: 'a1',
    emoji: '🛠️',
    title: 'Technik',
    by: 'jonas',
    created: '09-16 13:00',
    content: doc(p('Technische Entscheidungen und Betriebswissen zur neuen Website.')),
  },
  {
    id: 'pg_web_contactform',
    project: 'p_web',
    parent: 'pg_web_tech',
    rank: 'a0',
    emoji: '📮',
    title: 'Kontaktformular – Technik',
    by: 'jonas',
    created: '10-16 10:30',
    updated: '10-27 11:40',
    version: 2,
    updatedBy: 'jonas',
    content: doc(
      p('Das Formular prüft die Eingaben im Browser und noch einmal auf dem Server. Die Mails gehen über den zentralen Mailserver raus.'),
      h(2, 'Ablauf'),
      ol('Eingaben prüfen', 'Spam-Schutz mit Honeypot und Zeitprüfung', 'Mail an das Team, Bestätigung an die absendende Person'),
      h(2, 'Bekanntes Problem'),
      p('Unter Safari kann der Absende-Button doppelt auslösen, siehe WEB-47. Bis zur Lösung hilft ein Einmal-Token pro Seitenaufruf.'),
    ),
  },
  {
    id: 'pg_web_hosting',
    project: 'p_web',
    parent: 'pg_web_tech',
    rank: 'a1',
    emoji: '🚀',
    title: 'Deployment und Hosting',
    by: 'jonas',
    created: '10-01 16:00',
    content: doc(
      p('Die Seite läuft auf dem neuen Server in einem Docker-Stack. Deployments laufen über die CI.'),
      ul('Staging wird bei jedem Merge aktualisiert', 'Produktion wird nach Freigabe ausgerollt', 'Die Backups laufen nachts'),
    ),
  },
  {
    id: 'pg_web_domain',
    project: 'p_web',
    parent: 'pg_web_hosting',
    rank: 'a0',
    emoji: '🌐',
    title: 'Domain-Umzug',
    by: 'jonas',
    created: '10-13 14:20',
    updated: '10-27 16:30',
    version: 2,
    updatedBy: 'jonas',
    content: doc(
      h(2, 'Checkliste'),
      ol('TTL der DNS-Einträge senken', 'Neuen Server prüfen', 'DNS umstellen', 'Zertifikat prüfen', 'Alte Instanz als Fallback behalten'),
      p('Erledigt am 27.10., siehe WEB-39.'),
    ),
  },
  {
    id: 'pg_web_performance',
    project: 'p_web',
    parent: 'pg_web_tech',
    rank: 'a2',
    emoji: '⚡',
    title: 'Performance-Budget',
    by: 'mara',
    created: '10-20 10:00',
    content: doc(
      p('Ziele für die Startseite auf einem mittleren Smartphone im Mobilfunknetz.'),
      ul('Largest Contentful Paint unter 2,5 s', 'Gesamtgewicht unter 1 MB', 'Keine Layout-Sprünge beim Laden'),
      p('Die Prüfung in der CI folgt mit WEB-56.'),
    ),
  },
  {
    id: 'pg_web_meetings',
    project: 'p_web',
    rank: 'a2',
    emoji: '📅',
    title: 'Meetings',
    by: 'ida',
    created: '09-14 12:00',
    content: doc(p('Notizen aus den Terminen mit dem Team und dem Kunden.')),
  },
  {
    id: 'pg_web_kickoff',
    project: 'p_web',
    parent: 'pg_web_meetings',
    rank: 'a0',
    emoji: '📝',
    title: 'Kickoff-Notizen',
    by: 'ida',
    created: '09-14 17:15',
    content: doc(
      h(2, 'Kickoff am 14.9.'),
      ul('Ziel ist eine schnellere, barrierearme Website', 'Phase 1 bis 15.11., Phase 2 im Frühjahr', 'Ansprechpartnerin beim Kunden ist Frau Nordlund'),
      p('Nächster Termin: Abstimmung der Seitenstruktur.'),
    ),
  },

  /* ----------------------------------------------------------------------- APP */
  {
    id: 'pg_app_vision',
    project: 'p_app',
    rank: 'a0',
    emoji: '🎯',
    title: 'Produktvision',
    by: 'theo',
    created: '07-06 11:00',
    content: doc(
      p('Die App macht Bestellungen für die Kundinnen und Kunden von Hafenkontor so einfach wie möglich: wenige Schritte, klare Status, nichts Überflüssiges.'),
      h(2, 'Ziele der Version 2.0'),
      ul('Anmeldung mit Biometrie', 'Push-Mitteilungen zu Bestellungen', 'Bestellliste auch offline'),
    ),
  },
  {
    id: 'pg_app_api',
    project: 'p_app',
    rank: 'a1',
    emoji: '🔌',
    title: 'API-Schnittstelle',
    by: 'jonas',
    created: '07-20 09:30',
    content: doc(
      p('Die App spricht mit der Shop-API des Kunden. Alle Aufrufe laufen über einen Proxy, der die Tokens verwaltet.'),
      code('GET /v2/orders?status=open'),
      p('Die Zugangsdaten liegen im Passwortmanager, nicht im Repository.'),
    ),
  },
  {
    id: 'pg_app_approval',
    project: 'p_app',
    rank: 'a2',
    emoji: '✅',
    title: 'Freigabeprozess',
    by: 'theo',
    created: '07-08 15:00',
    content: doc(
      p('Items durchlaufen im Workflow „Agentur-Freigabe“ erst die interne Prüfung (Review) und danach die Kundenfreigabe.'),
      ol('Review durch eine zweite Person aus dem Team', 'Kundenfreigabe mit einem Testbuild', 'Abschluss in Done'),
      p('Aus Todo geht es nur nach In Progress oder Cancelled.'),
    ),
  },
  {
    id: 'pg_app_release',
    project: 'p_app',
    parent: 'pg_app_approval',
    rank: 'a0',
    emoji: '📦',
    title: 'Release-Checkliste',
    by: 'theo',
    created: '10-19 10:00',
    content: doc(ul('Release-Notes geschrieben (APP-16)', 'TestFlight-Gruppe eingerichtet (APP-18)', 'Store-Screenshots aktualisiert', 'Datenschutzerklärung geprüft')),
  },

  /* ----------------------------------------------------------------------- OPS */
  {
    id: 'pg_ops_servers',
    project: 'p_ops',
    rank: 'a0',
    emoji: '🖥️',
    title: 'Server-Übersicht',
    by: 'jonas',
    created: '08-28 10:00',
    content: doc(
      p('Zwei Anwendungsserver und ein Datenbankserver, alle hinter einem Load Balancer.'),
      ul('app-1 und app-2: Docker-Stack', 'db-1: Primär mit Replikat', 'mail-1: Postfix'),
    ),
  },
  {
    id: 'pg_ops_runbook',
    project: 'p_ops',
    parent: 'pg_ops_servers',
    rank: 'a0',
    emoji: '🚨',
    title: 'Runbook: Störung',
    by: 'jonas',
    created: '09-30 17:00',
    content: doc(
      h(2, 'Erste Schritte'),
      ol('Status im Monitoring prüfen', 'Letztes Deployment ansehen', 'Logs der betroffenen Dienste lesen', 'Bei Bedarf auf das letzte stabile Image zurückrollen'),
      p('Eskalation: Jonas, danach Mara.'),
    ),
  },
  {
    id: 'pg_ops_backup',
    project: 'p_ops',
    rank: 'a1',
    emoji: '💾',
    title: 'Backup und Restore',
    by: 'mara',
    created: '10-01 12:00',
    content: doc(p('Nachts um 03:00 läuft ein vollständiges Backup, tagsüber stündlich ein Inkrement.'), p('Der Restore-Test steht als OPS-14 an.')),
  },
];

export const pages: Page[] = rows.map((row): Page => {
  const updatedBy = USER_IDS[row.updatedBy ?? row.by];
  const page: Page = {
    id: row.id,
    project_id: row.project,
    parent_id: row.parent ?? null,
    rank: row.rank,
    title: row.title,
    emoji: row.emoji,
    content: row.content,
    version: row.version ?? 1,
    created_by: USER_IDS[row.by],
    created_at: at(row.created),
    updated_by: updatedBy,
    updated_at: at(row.updated ?? row.created),
  };
  // the first save of this page reports a conflict, so that the banner can be shown
  if (row.id === 'pg_web_structure') page.simulate_conflict_once = true;
  return page;
});

/** Three kept versions of "Seitenstruktur"; the last one is the current text. */
export const pageVersions: PageVersion[] = [
  {
    id: 'pv_structure_1',
    page_id: 'pg_web_structure',
    version: 1,
    title: 'Seitenstruktur',
    content: doc(h(2, 'Navigation'), ul('Start', 'Leistungen', 'Referenzen', 'Über uns', 'Impressum')),
    author_id: USER_IDS.ida,
    created_at: at('10-02 14:00'),
  },
  {
    id: 'pv_structure_2',
    page_id: 'pg_web_structure',
    version: 2,
    title: 'Seitenstruktur',
    content: doc(
      h(2, 'Navigation'),
      ul('Start', 'Leistungen (Beratung, Umsetzung, Betrieb)', 'Referenzen', 'Journal', 'Über uns', 'Anfahrt', 'Impressum'),
      p('Abgestimmt mit Studio Nordlicht am 6.10.'),
    ),
    author_id: USER_IDS.ida,
    created_at: at('10-06 16:20'),
  },
  {
    id: 'pv_structure_3',
    page_id: 'pg_web_structure',
    version: 3,
    title: 'Seitenstruktur',
    content: structuredClone(pages.find((page) => page.id === 'pg_web_structure')!.content),
    author_id: USER_IDS.ida,
    created_at: at('10-14 11:00'),
  },
];
