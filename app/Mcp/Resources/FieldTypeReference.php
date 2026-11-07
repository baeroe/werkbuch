<?php

namespace App\Mcp\Resources;

use Laravel\Mcp\Server\Attributes\Uri;

/** The field type section of the types and properties docs. */
#[Uri('werkbuch://reference/field-types')]
final class FieldTypeReference extends DocReference
{
    protected string $title = 'Field types of properties';

    protected string $description = 'The field types of a property, with their value, settings, default value and options, for the values of work items.';

    protected function page(): string
    {
        return 'concepts/types-and-properties.md';
    }
}
