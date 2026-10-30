<?php

namespace App\Rules;

use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

/**
 * A picture sent as a data URL (P15): `data:image/(png|jpeg|webp|gif);base64,…`, at most 2 MB once decoded and at most
 * 4096 pixels per side, and the bytes really are a picture of the type the head names. SVG never (it can carry
 * scripts). A value equal to the current URL of the picture passes: forms send the picture back unchanged.
 */
final class ImageDataUrl implements ValidationRule
{
    public const MAX_BYTES = 2 * 1024 * 1024;

    /** The longest side in pixels: larger pictures only cost memory where they are shown as small squares. */
    public const MAX_EDGE = 4096;

    /** @var list<string> */
    public const MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

    // \z, not $: a trailing line break must not pass
    public const PATTERN = '#^data:(image/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]*={0,2})\z#';

    public function __construct(private readonly ?string $current = null) {}

    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if ($value === $this->current) {
            return;
        }

        if (! is_string($value) || preg_match(self::PATTERN, $value, $match) !== 1) {
            $fail(__('field.image.invalid'));

            return;
        }

        // the size first, from the length of the base64 (three bytes per four characters, less the padding), without
        // decoding what is too large anyway
        if (intdiv(strlen($match[2]), 4) * 3 - substr_count(substr($match[2], -2), '=') > self::MAX_BYTES) {
            $fail(__('field.image.too_large', ['max' => self::MAX_BYTES / 1024 / 1024]));

            return;
        }

        // getimagesizefromstring warns about bytes too short for any header; for this rule that is just "no picture"
        $bytes = (string) base64_decode($match[2], true);
        $size = $bytes === '' ? false : @getimagesizefromstring($bytes);

        if ($size === false || $size['mime'] !== $match[1] || base64_encode($bytes) !== $match[2]) {
            $fail(__('field.image.invalid'));

            return;
        }

        if ($size[0] > self::MAX_EDGE || $size[1] > self::MAX_EDGE) {
            $fail(__('field.image.too_wide', ['max' => self::MAX_EDGE]));
        }
    }
}
