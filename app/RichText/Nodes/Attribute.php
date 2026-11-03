<?php

namespace App\RichText\Nodes;

use DOMElement;

/**
 * An attribute of a node's element as tiptap-php reads it: missing or empty is `null`, anything else as written, `"0"`
 * included (an alt text or a file name of `0` is one, T5-M5).
 */
final class Attribute
{
    public static function of(DOMElement $element, string $name): ?string
    {
        $value = $element->getAttribute($name);

        return $value === '' ? null : $value;
    }
}
