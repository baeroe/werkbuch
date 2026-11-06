<?php

namespace App\Http\Api;

use Attribute;

/**
 * Names the JSON body of a controller method (`#[Body(AccountSchemas::class, 'organization')]`, K15): the actions
 * validate their input themselves, so Scramble cannot read it, and the schema is written down in a class of
 * `App\OpenApi` (a static method that returns plain JSON Schema). A test holds its keys against the `FIELDS` of the
 * action that reads them. The media type is JSON unless the method says otherwise (`multipart/form-data` for an upload).
 */
#[Attribute(Attribute::TARGET_METHOD)]
final readonly class Body
{
    /**
     * @param  class-string  $source
     */
    public function __construct(public string $source, public string $method, public string $type = 'application/json') {}

    /**
     * @return array<string, mixed>
     */
    public function schema(): array
    {
        /** @var array<string, mixed> */
        return ($this->source)::{$this->method}();
    }
}
