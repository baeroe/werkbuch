<?php

namespace App\Domain;

/**
 * The one rule for an emoji (view icons, reactions): exactly one extended grapheme of at most `MAX_BYTES` that is an
 * emoji. That is a pictograph (with its selector U+FE0F, skin tones and zero-width joins to more pictographs), a flag
 * (two regional indicators), a keycap (`1️⃣`, also without the selector) or a subdivision flag (🏴 with tags). A text
 * symbol with the emoji property (`©`, `‼`, `™`, `❤`) counts only with its selector U+FE0F, a modifier base (☝) also
 * with a skin tone. A pictograph the Unicode data of PCRE does not know yet counts as one (a newer emoji).
 * `resources/js/components/ui/EmojiPicker.tsx` (`isEmoji`) follows the same rule.
 */
final class Emoji
{
    public const MAX_BYTES = 64;

    private const SKIN = '\x{1F3FB}-\x{1F3FF}';

    /** A pictograph shown as an emoji by itself, a text symbol before its selector, a modifier base before a skin tone. */
    private const LEAD = '(?:(?=\p{Extended_Pictographic})[\p{Emoji_Presentation}\p{Cn}]'
        .'|\p{Extended_Pictographic}(?=\x{FE0F})'
        .'|\p{Emoji_Modifier_Base}(?=['.self::SKIN.']))';

    private const MARKS = '[\x{FE0F}'.self::SKIN.']*';

    private const PATTERN = '/^(?:'
        .'\p{Regional_Indicator}{2}'
        .'|[0-9#*]\x{FE0F}?\x{20E3}'
        .'|\x{1F3F4}[\x{E0020}-\x{E007E}]+\x{E007F}'
        .'|'.self::LEAD.self::MARKS.'(?:\x{200D}\p{Extended_Pictographic}'.self::MARKS.')*'
        .')\z/u';

    public static function is(string $text): bool
    {
        return $text !== ''
            && strlen($text) <= self::MAX_BYTES
            && preg_match(self::PATTERN, $text) === 1
            && grapheme_strlen($text) === 1;
    }
}
