<?php

namespace App\OpenApi;

use Dedoc\Scramble\Support\Generator\Types\Type;

/**
 * A schema written as plain JSON Schema (`Schemas`), for Scramble's object model: it serializes as it was given.
 */
final class JsonSchema extends Type
{
    /**
     * @param  array<string, mixed>  $schema
     */
    public function __construct(private readonly array $schema)
    {
        parent::__construct('object');
    }

    public function serializeAs31(): mixed
    {
        return $this->schema;
    }

    public function serializeAs32(): mixed
    {
        return $this->schema;
    }
}
