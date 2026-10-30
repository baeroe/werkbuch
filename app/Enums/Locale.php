<?php

namespace App\Enums;

enum Locale: string
{
    case En = 'en';
    case De = 'de';

    /**
     * The default language of the organization (config until Phase 2); the first case when the config names no supported one.
     */
    public static function default(): self
    {
        return self::tryFrom((string) config('app.locale')) ?? self::cases()[0];
    }

    /**
     * @return list<string>
     */
    public static function values(): array
    {
        return array_map(static fn (self $locale): string => $locale->value, self::cases());
    }
}
