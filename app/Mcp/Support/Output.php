<?php

namespace App\Mcp\Support;

use stdClass;

/**
 * Rich text in the result of a tool only as Markdown: an agent reads Markdown, and the Tiptap JSON next to it would
 * double the tokens. In every object of the answer, `<x>_json` goes where `<x>` stands next to it (`description`,
 * `content`, `body`), and the rich text values in `values` become the Markdown of `values_markdown`, which goes. A
 * `_json` key without its sibling (a lean answer, a value that is only JSON) stays. Objects stay objects (`stdClass`),
 * so an empty one (`values: {}`) stays `{}` in the JSON of the result.
 */
final class Output
{
    /**
     * @param  array<array-key, mixed>|stdClass  $json
     * @return array<array-key, mixed>|stdClass
     */
    public static function markdown(array|stdClass $json): array|stdClass
    {
        if (is_array($json) && array_is_list($json)) {
            return array_map(self::value(...), $json);
        }

        $object = (array) $json;

        foreach (array_keys($object) as $key) {
            $key = (string) $key;
            if (str_ends_with($key, '_json') && array_key_exists(substr($key, 0, -5), $object)) {
                unset($object[$key]);
            }
        }

        $values = $object['values'] ?? null;
        $markdown = $object['values_markdown'] ?? null;
        if (self::isObject($values) && self::isObject($markdown)) {
            $merged = array_replace((array) $values, (array) $markdown);
            $object['values'] = $values instanceof stdClass ? (object) $merged : $merged;
            unset($object['values_markdown']);
        }

        $object = array_map(self::value(...), $object);

        return $json instanceof stdClass ? (object) $object : $object;
    }

    private static function value(mixed $value): mixed
    {
        return is_array($value) || $value instanceof stdClass ? self::markdown($value) : $value;
    }

    private static function isObject(mixed $value): bool
    {
        return $value instanceof stdClass || (is_array($value) && ($value === [] || ! array_is_list($value)));
    }
}
