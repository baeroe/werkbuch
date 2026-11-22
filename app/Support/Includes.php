<?php

namespace App\Support;

use Illuminate\Validation\ValidationException;

/**
 * `include` of a single read (`GET /work-items/{item}`, `GET /projects/{project}`): the names of what the resource
 * embeds. A list of the query reads `include` through its `ListSpec` instead.
 */
final class Includes
{
    /**
     * The names, trimmed, without empty ones and in the order of `$allowed`; anything else is 422 at `include`
     * (`field.include.unknown`, upper and lower case count).
     *
     * @param  array<array-key, mixed>  $include
     * @param  list<string>  $allowed
     * @return list<string>
     *
     * @throws ValidationException
     */
    public static function read(array $include, array $allowed): array
    {
        $names = [];
        foreach ($include as $name) {
            $name = is_string($name) ? trim($name) : $name;
            if ($name === '') {
                continue;
            }
            if (! is_string($name) || ! in_array($name, $allowed, true)) {
                throw ValidationException::withMessages(['include' => __('field.include.unknown', [
                    'name' => is_string($name) ? $name : get_debug_type($name),
                    'allowed' => implode(', ', $allowed),
                ])]);
            }
            $names[] = $name;
        }

        return array_values(array_intersect($allowed, $names));
    }

    /**
     * `include` of a query string as Laravel reads it: a text separated by commas or a list (`include[]=`).
     *
     * @return array<array-key, mixed>
     */
    public static function fromQuery(mixed $include): array
    {
        return is_string($include) ? explode(',', $include) : (array) $include;
    }
}
