import type { Locale } from '@/lib/page';

/** Every key of `lang/en.json`; `lang/de.json` has the same keys (a test keeps them equal). */
export type TranslationKey = keyof typeof import('../../../lang/en.json') & string;

/** A stem `K` for which `K.one` and `K.other` are keys: what `tn()` takes. */
export type PluralKey = {
  [K in TranslationKey]: K extends `${infer Stem}.one` ? (`${Stem}.other` extends TranslationKey ? Stem : never) : never;
}[TranslationKey];

export type TranslationParams = Record<string, string | number>;

let locale: Locale = 'en';
let translations: Record<string, string> = {};

/** Takes the language and the texts the server shared with the page (`SharedProps`). */
export function initI18n(props: { locale: Locale; translations: Record<string, string> }): void {
  locale = props.locale;
  translations = props.translations;
}

export function getLocale(): Locale {
  return locale;
}

/** The `Intl` locale for dates, numbers and lists; use it instead of a fixed `'de-DE'`. */
export function intlLocale(): 'de-DE' | 'en-GB' {
  return locale === 'de' ? 'de-DE' : 'en-GB';
}

export function hasTranslation(key: string): key is TranslationKey {
  return Object.hasOwn(translations, key);
}

function fill(text: string, params: TranslationParams): string {
  return text.replace(/:([a-z_]+)/g, (match, name: string) => (Object.hasOwn(params, name) ? String(params[name]) : match));
}

/** The text of a key in the language of the page; a key without text shows as itself. */
export function t(key: TranslationKey, params: TranslationParams = {}): string {
  return fill(translations[key] ?? key, params);
}

/** The text for a count: `<key>.one` for exactly one, else `<key>.other`; `:count` is the count in the number format of the language. */
export function tn(key: PluralKey, count: number, params: TranslationParams = {}): string {
  const form = `${key}.${count === 1 ? 'one' : 'other'}` as TranslationKey;

  return t(form, { ...params, count: new Intl.NumberFormat(intlLocale()).format(count) });
}

/**
 * The texts of a page belong to one language. After a visit that came back in another language (the account's own
 * language beats the cookie) the page reloads, so the shared texts arrive again.
 */
export function reloadIfLocaleChanged(next: Locale, reload: () => void): void {
  if (next !== locale) {
    reload();
  }
}
