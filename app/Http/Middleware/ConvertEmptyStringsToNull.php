<?php

namespace App\Http\Middleware;

use App\RichText\RichTextInput;
use Illuminate\Foundation\Http\Middleware\ConvertEmptyStringsToNull as BaseConvertEmptyStringsToNull;
use Illuminate\Support\Str;

/**
 * Laravel's ConvertEmptyStringsToNull, which leaves rich text (RichTextInput::RAW_KEYS) as the editor sent it; the
 * framework's middleware can only skip whole requests. bootstrap/app.php replaces it with this one.
 */
class ConvertEmptyStringsToNull extends BaseConvertEmptyStringsToNull
{
    /**
     * @param  string  $key
     * @param  mixed  $value
     * @return mixed
     */
    protected function transform($key, $value)
    {
        return Str::is(RichTextInput::RAW_KEYS, $key) ? $value : parent::transform($key, $value);
    }
}
