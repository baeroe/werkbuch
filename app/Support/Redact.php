<?php

namespace App\Support;

/**
 * A text of an error as the log and the system page show it (A375, T11-M7): in every URL the user, the password and
 * the query (with the fragment) become `…`, since a receiver may take its token there; then the first sentence (up to
 * the first full stop before a space or the first line break), at most `MAX` characters.
 */
final class Redact
{
    public const MAX = 300;

    public static function text(string $text): string
    {
        $masked = (string) preg_replace_callback(
            '~\b([a-z][a-z0-9+.\-]*://)([^\s/?#@]*@)?([^\s?#]*)([?#]\S*)?~i',
            fn (array $url): string => $url[1].($url[2] !== '' ? '…@' : '').$url[3].(($url[4] ?? '') !== '' ? '?…' : ''),
            $text,
        );

        $sentence = preg_split('/(?<=\.)\s|\R/u', trim($masked), 2)[0] ?? '';

        return mb_substr($sentence, 0, self::MAX);
    }
}
