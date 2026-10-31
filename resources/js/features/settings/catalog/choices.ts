/*
 * The fixed choices of the catalogs and the keys of their names: tones, status shapes and categories, property field
 * types and type icons (spec 4.5 to 4.7). One source for every screen that offers them (13b "STATE_ICONS duplicated").
 * The keys stand in fixed records instead of being built from the values: values like `three-quarter` are no valid
 * key, and the scan of the used keys finds only literal ones (P21).
 */

import type { TypeIconName } from '@/components/ui/TypeTab';
import type { TranslationKey } from '@/lib/i18n';
import type { FieldType, StateCategory, StateIcon, TypeTone } from '@/types';

/* ------------------------------------------------------------------------- tones */

export const TONES: readonly TypeTone[] = ['sky', 'ochre', 'moss', 'plum', 'sand', 'slate'];

export const TONE_LABELS: Record<TypeTone, TranslationKey> = {
  sky: 'settings.catalog.tone.sky',
  ochre: 'settings.catalog.tone.ochre',
  moss: 'settings.catalog.tone.moss',
  plum: 'settings.catalog.tone.plum',
  sand: 'settings.catalog.tone.sand',
  slate: 'settings.catalog.tone.slate',
};

/* ------------------------------------------------------------------------ states */

/** The fixed set of status shapes (DESIGN.md): the colour follows the category, so there is no free colour. */
export const STATE_ICONS: readonly StateIcon[] = ['dashed', 'circle', 'half', 'three-quarter', 'pause', 'check', 'cross'];

export const STATE_ICON_LABELS: Record<StateIcon, TranslationKey> = {
  dashed: 'settings.catalog.state_icon.dashed',
  circle: 'settings.catalog.state_icon.circle',
  half: 'settings.catalog.state_icon.half',
  'three-quarter': 'settings.catalog.state_icon.three_quarter',
  pause: 'settings.catalog.state_icon.pause',
  check: 'settings.catalog.state_icon.check',
  cross: 'settings.catalog.state_icon.cross',
};

/** The categories as the spec names them (4.5), with what each one means for a status. */
export const CATEGORY_LABELS: Record<StateCategory, TranslationKey> = {
  backlog: 'settings.catalog.category.backlog',
  unstarted: 'settings.catalog.category.unstarted',
  started: 'settings.catalog.category.started',
  completed: 'settings.catalog.category.completed',
  canceled: 'settings.catalog.category.canceled',
};

export const CATEGORY_HINTS: Record<StateCategory, TranslationKey> = {
  backlog: 'settings.catalog.category_hint.backlog',
  unstarted: 'settings.catalog.category_hint.unstarted',
  started: 'settings.catalog.category_hint.started',
  completed: 'settings.catalog.category_hint.completed',
  canceled: 'settings.catalog.category_hint.canceled',
};

/* ------------------------------------------------------------------- property fields */

export const FIELD_TYPES: readonly FieldType[] = ['text', 'number', 'dropdown', 'boolean', 'date', 'member', 'rich_text', 'url'];

export const FIELD_TYPE_LABELS: Record<FieldType, TranslationKey> = {
  text: 'settings.catalog.field_type.text',
  number: 'settings.catalog.field_type.number',
  dropdown: 'settings.catalog.field_type.dropdown',
  boolean: 'settings.catalog.field_type.boolean',
  date: 'settings.catalog.field_type.date',
  member: 'settings.catalog.field_type.member',
  rich_text: 'settings.catalog.field_type.rich_text',
  url: 'settings.catalog.field_type.url',
};

export const FIELD_TYPE_HINTS: Record<FieldType, TranslationKey> = {
  text: 'settings.catalog.field_type_hint.text',
  number: 'settings.catalog.field_type_hint.number',
  dropdown: 'settings.catalog.field_type_hint.dropdown',
  boolean: 'settings.catalog.field_type_hint.boolean',
  date: 'settings.catalog.field_type_hint.date',
  member: 'settings.catalog.field_type_hint.member',
  rich_text: 'settings.catalog.field_type_hint.rich_text',
  url: 'settings.catalog.field_type_hint.url',
};

/* ------------------------------------------------------------------ type icons */

/** The names of the icons a type can use (`TYPE_ICONS` of the component set), for screen readers and tooltips. */
export const TYPE_ICON_LABELS: Record<TypeIconName, TranslationKey> = {
  'square-check': 'settings.catalog.type_icon.square_check',
  bug: 'settings.catalog.type_icon.bug',
  zap: 'settings.catalog.type_icon.zap',
  layers: 'settings.catalog.type_icon.layers',
  'message-square-heart': 'settings.catalog.type_icon.message_square_heart',
  'book-open': 'settings.catalog.type_icon.book_open',
  'clipboard-list': 'settings.catalog.type_icon.clipboard_list',
  'file-text': 'settings.catalog.type_icon.file_text',
  flag: 'settings.catalog.type_icon.flag',
  'flask-conical': 'settings.catalog.type_icon.flask_conical',
  lightbulb: 'settings.catalog.type_icon.lightbulb',
  megaphone: 'settings.catalog.type_icon.megaphone',
  package: 'settings.catalog.type_icon.package',
  palette: 'settings.catalog.type_icon.palette',
  rocket: 'settings.catalog.type_icon.rocket',
  shield: 'settings.catalog.type_icon.shield',
  star: 'settings.catalog.type_icon.star',
  target: 'settings.catalog.type_icon.target',
  users: 'settings.catalog.type_icon.users',
  wrench: 'settings.catalog.type_icon.wrench',
};
