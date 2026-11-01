<?php

namespace App\Domain\Filter;

use RuntimeException;

/**
 * Input that does not fit its schema (filter, sort, display), with every path that is wrong and its code. Paths are
 * relative to the root of the schema (`''` for the root itself, `conditions.0.op`); callers put their own prefix in
 * front (`errorsAt('filter')`).
 */
final class InvalidInput extends RuntimeException
{
    /**
     * @param  array<string, string>  $errors  path → code
     */
    public function __construct(public readonly array $errors)
    {
        parent::__construct('The input does not fit its schema: '.implode(', ', array_keys($errors)));
    }

    /**
     * The errors with the paths under the prefix: `''` becomes the prefix itself.
     *
     * @return array<string, string>
     */
    public function errorsAt(string $prefix): array
    {
        $errors = [];
        foreach ($this->errors as $path => $code) {
            $errors[$path === '' ? $prefix : "{$prefix}.{$path}"] = $code;
        }

        return $errors;
    }
}
