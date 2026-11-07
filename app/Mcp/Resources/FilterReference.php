<?php

namespace App\Mcp\Resources;

use Laravel\Mcp\Server\Attributes\Uri;

/** The filter section of the views docs. */
#[Uri('werkbuch://reference/filters')]
final class FilterReference extends DocReference
{
    protected string $title = 'Filters';

    protected string $description = 'The JSON form of a filter: fields, operators and values of a condition, for the filter arguments of the item, view and template tools.';

    protected function page(): string
    {
        return 'concepts/views.md';
    }
}
