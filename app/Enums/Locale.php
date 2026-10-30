<?php

namespace App\Enums;

enum Locale: string
{
    case En = 'en';
    case De = 'de';

    /**
     * @return list<string>
     */
    public static function values(): array
    {
        return array_map(static fn (self $locale): string => $locale->value, self::cases());
    }
}
