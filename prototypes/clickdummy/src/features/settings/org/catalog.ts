/*
 * The fixed choices of the organisation settings and their German names: tones, status shapes and categories,
 * property field types, token abilities and the webhook events (spec 4.5 to 4.7, 4.2, 6.3). Pure data, so the
 * sections and the tests share one source.
 */

import type { FieldType, StateCategory, StateIcon, TokenAbility, TypeTone } from '@/types';

/* ------------------------------------------------------------------------- tones */

export const TONES: readonly TypeTone[] = ['sky', 'ochre', 'moss', 'plum', 'sand', 'slate'];

export const TONE_NAMES: Record<TypeTone, string> = {
  sky: 'Himmel',
  ochre: 'Ocker',
  moss: 'Moos',
  plum: 'Pflaume',
  sand: 'Sand',
  slate: 'Schiefer',
};

/* --------------------------------------------------------------------- time zones */

/**
 * The time zones the picker offers: the ones most teams work in, fewer than fifty so the list needs no virtualisation.
 * The zone the organisation has now is always added, so a zone from elsewhere is never lost by opening the form.
 */
export const COMMON_ZONES: readonly string[] = [
  'Africa/Cairo',
  'Africa/Johannesburg',
  'Africa/Lagos',
  'Africa/Nairobi',
  'America/Argentina/Buenos_Aires',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Mexico_City',
  'America/New_York',
  'America/Sao_Paulo',
  'America/Toronto',
  'Asia/Bangkok',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Seoul',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Atlantic/Reykjavik',
  'Australia/Sydney',
  'Europe/Amsterdam',
  'Europe/Athens',
  'Europe/Berlin',
  'Europe/Brussels',
  'Europe/Bucharest',
  'Europe/Copenhagen',
  'Europe/Dublin',
  'Europe/Helsinki',
  'Europe/Istanbul',
  'Europe/Kyiv',
  'Europe/Lisbon',
  'Europe/London',
  'Europe/Madrid',
  'Europe/Moscow',
  'Europe/Oslo',
  'Europe/Paris',
  'Europe/Prague',
  'Europe/Rome',
  'Europe/Stockholm',
  'Europe/Vienna',
  'Europe/Warsaw',
  'Europe/Zurich',
  'Pacific/Auckland',
  'UTC',
];

/* ------------------------------------------------------------------------ states */

/** The fixed set of status shapes (DESIGN.md): the colour follows the category, so there is no free colour. */
export const STATE_ICONS: readonly StateIcon[] = ['dashed', 'circle', 'half', 'three-quarter', 'pause', 'check', 'cross'];

export const STATE_ICON_NAMES: Record<StateIcon, string> = {
  dashed: 'Gestrichelter Kreis',
  circle: 'Kreis',
  half: 'Halb gefüllt',
  'three-quarter': 'Dreiviertel gefüllt',
  pause: 'Pause',
  check: 'Haken',
  cross: 'Kreuz',
};

/** The categories as the spec names them (4.5), with what each one means for a status. */
export const CATEGORY_NAMES: Record<StateCategory, string> = {
  backlog: 'Backlog',
  unstarted: 'Unstarted',
  started: 'Started',
  completed: 'Completed',
  canceled: 'Canceled',
};

export const CATEGORY_HINTS: Record<StateCategory, string> = {
  backlog: 'Noch nicht eingeplant. Offen.',
  unstarted: 'Eingeplant, aber nicht begonnen. Offen.',
  started: 'In Arbeit. Offen, zählt für den Fortschritt.',
  completed: 'Erledigt. Schließt das Item und verlangt eine Resolution.',
  canceled: 'Abgebrochen. Schließt das Item und verlangt eine Resolution.',
};

/* ------------------------------------------------------------------- property fields */

export const FIELD_TYPE_NAMES: Record<FieldType, string> = {
  text: 'Text',
  number: 'Zahl',
  dropdown: 'Dropdown',
  boolean: 'Ja oder nein',
  date: 'Datum',
  member: 'Personenauswahl',
  rich_text: 'Rich Text',
  url: 'URL',
};

export const FIELD_TYPE_HINTS: Record<FieldType, string> = {
  text: 'Eine Zeile, bis 255 Zeichen.',
  number: 'Eine Dezimalzahl mit 0 bis 4 Nachkommastellen.',
  dropdown: 'Eine oder mehrere Optionen aus einer Liste.',
  boolean: 'Ein Schalter: ja oder nein.',
  date: 'Ein Datum ohne Uhrzeit.',
  member: 'Personen oder Bots mit Zugriff auf das Projekt.',
  rich_text: 'Formatierter Text im selben Editor wie die Beschreibung.',
  url: 'Eine Adresse mit http oder https.',
};

export const FIELD_TYPES = Object.keys(FIELD_TYPE_NAMES) as FieldType[];

/* ------------------------------------------------------------------ type icons */

/** German names of the icons a type can use (`TYPE_ICONS` of the component set), for screen readers and tooltips. */
export const TYPE_ICON_NAMES: Record<string, string> = {
  'square-check': 'Häkchen im Quadrat',
  bug: 'Käfer',
  zap: 'Blitz',
  layers: 'Ebenen',
  'message-square-heart': 'Sprechblase mit Herz',
  'book-open': 'Aufgeschlagenes Buch',
  'clipboard-list': 'Klemmbrett',
  'file-text': 'Dokument',
  flag: 'Flagge',
  'flask-conical': 'Kolben',
  lightbulb: 'Glühbirne',
  megaphone: 'Megafon',
  package: 'Paket',
  palette: 'Farbpalette',
  rocket: 'Rakete',
  shield: 'Schild',
  star: 'Stern',
  target: 'Zielscheibe',
  users: 'Team',
  wrench: 'Schraubenschlüssel',
};

/* ----------------------------------------------------------------------- tokens */

export const ABILITIES: readonly { value: TokenAbility; label: string; hint: string }[] = [
  { value: 'read', label: 'Lesen', hint: 'Daten abrufen, über REST und MCP.' },
  { value: 'write', label: 'Schreiben', hint: 'Daten anlegen und ändern.' },
  { value: 'mcp', label: 'MCP', hint: 'Den MCP-Server unter /mcp benutzen. Lese-Tools brauchen zusätzlich Lesen, Schreib-Tools Schreiben.' },
];

export const ABILITY_NAMES: Record<TokenAbility, string> = { read: 'Lesen', write: 'Schreiben', mcp: 'MCP' };

/* --------------------------------------------------------------------- webhooks */

export interface EventGroup {
  group: string;
  label: string;
  events: { event: string; label: string }[];
}

/** The webhook events of spec 6.3, grouped as the spec groups them; `group.*` stands for the whole group. */
export const EVENT_GROUPS: readonly EventGroup[] = [
  {
    group: 'project',
    label: 'Projekte',
    events: [
      { event: 'created', label: 'Projekt angelegt' },
      { event: 'updated', label: 'Projekt geändert' },
      { event: 'archived', label: 'Projekt archiviert' },
      { event: 'deleted', label: 'Projekt gelöscht' },
      { event: 'member_added', label: 'Mitglied hinzugefügt' },
      { event: 'member_removed', label: 'Mitglied entfernt' },
    ],
  },
  {
    group: 'work_item',
    label: 'Work Items',
    events: [
      { event: 'created', label: 'Item angelegt' },
      { event: 'updated', label: 'Item geändert' },
      { event: 'state_changed', label: 'Status geändert' },
      { event: 'assigned', label: 'Item zugewiesen' },
      { event: 'archived', label: 'Item archiviert' },
      { event: 'restored', label: 'Item wiederhergestellt' },
      { event: 'deleted', label: 'Item gelöscht' },
      { event: 'relation_added', label: 'Relation hinzugefügt' },
      { event: 'relation_removed', label: 'Relation entfernt' },
    ],
  },
  {
    group: 'comment',
    label: 'Kommentare',
    events: [
      { event: 'created', label: 'Kommentar geschrieben' },
      { event: 'updated', label: 'Kommentar bearbeitet' },
      { event: 'deleted', label: 'Kommentar gelöscht' },
    ],
  },
  {
    group: 'page',
    label: 'Wiki-Seiten',
    events: [
      { event: 'created', label: 'Seite angelegt' },
      { event: 'updated', label: 'Seite geändert' },
      { event: 'moved', label: 'Seite verschoben' },
      { event: 'deleted', label: 'Seite gelöscht' },
    ],
  },
  {
    group: 'bot',
    label: 'Bots',
    events: [
      { event: 'mentioned', label: 'Bot erwähnt' },
      { event: 'assigned', label: 'Bot zugewiesen' },
    ],
  },
  {
    group: 'template',
    label: 'Vorlagen',
    events: [{ event: 'run_failed', label: 'Lauf fehlgeschlagen' }],
  },
];

/** What a stored event name such as `work_item.*` or `bot.assigned` reads like to a person. */
export function eventLabel(name: string): string {
  // the test ping is no event of the catalog; it only shows up in the log of deliveries
  if (name === 'ping') return 'Test-Ping';
  const [groupName, event] = name.split('.');
  const group = EVENT_GROUPS.find((entry) => entry.group === groupName);
  if (!group) return name;
  if (event === '*') return `Alle ${group.label}`;
  return group.events.find((entry) => entry.event === event)?.label ?? name;
}
