<?php

namespace Tests\Support\OpenApi;

use App\Support\ListFilter;
use App\Support\ListSpec;
use Illuminate\Database\Eloquent\Builder;

/**
 * The rules of two lists for `ListParametersTest`: one with every kind of filter, sorts and includes, one fixed.
 */
final class ListOfAction
{
    public static function spec(): ListSpec
    {
        return new ListSpec(
            filters: [
                ListFilter::exact('type', values: ['person', 'bot']),
                ListFilter::exact('owner_id'),
                ListFilter::partial('name'),
                ListFilter::boolean('disabled', 'disabled_at'),
                ListFilter::scope('kind', 'list<string>', fn (Builder $query, mixed $kinds) => $query->whereIn('kind', (array) $kinds)),
                ListFilter::scope('member', 'boolean', fn (Builder $query) => $query),
                ListFilter::scope('handle', 'string', fn (Builder $query) => $query),
            ],
            sorts: ['name' => 'users.name', 'created_at' => 'users.created_at'],
            default: ['-created_at'],
            includes: ['members', 'owner'],
        );
    }

    public static function fixedSpec(): ListSpec
    {
        return ListSpec::fixed();
    }
}
