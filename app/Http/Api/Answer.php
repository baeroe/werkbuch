<?php

namespace App\Http\Api;

use Attribute;

/**
 * Names the JSON answer of a controller method that is no `{data: Resource}` (`#[Answer(201, TokenSchemas::class,
 * 'created', 'The new token ...')]`): an object the controller builds itself, like `{token, plain_text}` or the state
 * of the second factor. The schema is plain JSON Schema from a static method of a class in `App\OpenApi`; it replaces
 * what Scramble inferred for the status.
 */
#[Attribute(Attribute::TARGET_METHOD)]
final readonly class Answer
{
    /**
     * @param  class-string  $source
     */
    public function __construct(public int $status, public string $source, public string $method, public string $description) {}

    /**
     * @return array<string, mixed>
     */
    public function schema(): array
    {
        /** @var array<string, mixed> */
        return ($this->source)::{$this->method}();
    }
}
