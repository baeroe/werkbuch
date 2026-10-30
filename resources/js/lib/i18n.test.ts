import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getLocale,
  hasTranslation,
  initI18n,
  intlLocale,
  reloadIfLocaleChanged,
  t,
  tn,
  type PluralKey,
  type TranslationKey,
} from '@/lib/i18n';

describe('i18n', () => {
  beforeEach(() =>
    initI18n({
      locale: 'en',
      translations: { 'common.close': 'Close', 'x.greeting': 'Hi :name', 'x.items.one': ':count item', 'x.items.other': ':count items' },
    }),
  );

  it('fills placeholders', () => expect(t('x.greeting' as TranslationKey, { name: 'Mara' })).toBe('Hi Mara'));

  it('leaves placeholders without a value and fills numbers', () => {
    expect(t('x.greeting' as TranslationKey)).toBe('Hi :name');
    expect(t('x.greeting' as TranslationKey, { name: 3 })).toBe('Hi 3');
  });

  it('shows a missing key as itself', () => expect(t('x.missing' as TranslationKey)).toBe('x.missing'));

  it('picks one or other and formats the count in the language', () => {
    expect(tn('x.items' as PluralKey, 1)).toBe('1 item');
    expect(tn('x.items' as PluralKey, 0)).toBe('0 items');
    expect(tn('x.items' as PluralKey, 1200)).toBe('1,200 items');
    initI18n({ locale: 'de', translations: { 'x.items.one': ':count Item', 'x.items.other': ':count Items' } });
    expect(tn('x.items' as PluralKey, 1200)).toBe('1.200 Items');
  });

  it('names the Intl locale', () => {
    expect(intlLocale()).toBe('en-GB');
    initI18n({ locale: 'de', translations: {} });
    expect(intlLocale()).toBe('de-DE');
    expect(getLocale()).toBe('de');
  });

  it('knows which keys exist', () => {
    expect(hasTranslation('common.close')).toBe(true);
    expect(hasTranslation('nope.nope')).toBe(false);
    expect(hasTranslation('toString')).toBe(false);
  });

  it('reloads only when the language of the visit differs from the language of the page', () => {
    const reload = vi.fn();
    reloadIfLocaleChanged('en', reload);
    expect(reload).not.toHaveBeenCalled();
    reloadIfLocaleChanged('de', reload);
    expect(reload).toHaveBeenCalledOnce();
  });
});
