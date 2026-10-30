<?php

namespace App\Support;

use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

/**
 * Which page of a list a request asks for (spec 6.1): a cursor from the previous page and the page size, `per_page`
 * 1 to 100, by default 100.
 */
final readonly class PageArgs
{
    public const MAX_PER_PAGE = 100;

    public function __construct(public ?string $cursor, public int $perPage) {}

    /**
     * @param  array<array-key, mixed>  $input  the query of the request
     *
     * @throws ValidationException at `per_page` or `cursor`
     */
    public static function from(array $input): self
    {
        $valid = Validator::make($input, [
            'cursor' => ['nullable', 'string'],
            'per_page' => ['nullable', 'integer', 'between:1,'.self::MAX_PER_PAGE],
        ])->validate();

        return new self($valid['cursor'] ?? null, (int) ($valid['per_page'] ?? self::MAX_PER_PAGE));
    }
}
