<?php

namespace Database\Seeders\Demo\Texts;

use App\Enums\Locale;
use RuntimeException;

/**
 * The texts of the demo seeders in the language they seed (DemoSeeder German, DemoSeederEn English). The seeders keep
 * one structure (handles, identifiers, keys, times, relations) and take every text from here by a key that names no
 * language. A key the language lacks throws: there is no fallback to German, so a half translated demo shows at once.
 * Only for the seeders; the language is static and DemoSeeder sets it back when it is done.
 */
final class DemoTexts
{
    private static Locale $locale = Locale::De;

    public static function use(Locale $locale): void
    {
        self::$locale = $locale;
    }

    public static function current(): Locale
    {
        return self::$locale;
    }

    /**
     * Whether the active language has the key: for a text only some rows have (an item without a description). Both
     * languages hold the same keys (EnglishDemoTextsTest), so this never hides a missing translation.
     */
    public static function has(string $key): bool
    {
        return isset(self::texts(self::$locale)[$key]);
    }

    /**
     * The text of the key in the active language, or in the one given.
     */
    public static function get(string $key, ?Locale $locale = null): string
    {
        $locale ??= self::$locale;

        return self::texts($locale)[$key] ?? throw new RuntimeException("The demo texts lack the key {$key} ({$locale->value}).");
    }

    /**
     * @return array<string, string>
     */
    private static function texts(Locale $locale): array
    {
        return match ($locale) {
            Locale::De => German::TEXTS,
            Locale::En => English::TEXTS,
        };
    }
}
