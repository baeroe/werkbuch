<?php

namespace App\Enums;

use App\Models\Organization;

enum Locale: string
{
    case En = 'en';
    case De = 'de';

    /**
     * The default language of the organization: the language before sign-in and for accounts without their own.
     */
    public static function default(): self
    {
        return Organization::current()->locale;
    }

    /**
     * @return list<string>
     */
    public static function values(): array
    {
        return array_map(static fn (self $locale): string => $locale->value, self::cases());
    }
}
