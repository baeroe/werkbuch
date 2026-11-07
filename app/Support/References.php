<?php

namespace App\Support;

use App\Exceptions\Problem;
use App\Models\Project;
use App\Models\WorkItem;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

/**
 * Finds a row by the reference a client sends, the same way for REST (the bindings of routes/api.php) and MCP: a
 * project by its ULID, identifier or a former identifier, a work item by its ULID or key (any case, also with a former
 * identifier: `resolved_by_former_identifier`), every other row only by its ULID (any case). An unknown reference is
 * a 404 without detail. Whether the account sees the row, the action decides.
 */
final class References
{
    /**
     * @throws Problem
     */
    public static function project(string $ref): Project
    {
        return Project::findByReference($ref) ?? throw Problem::notFound();
    }

    /**
     * @throws Problem
     */
    public static function item(string $ref): WorkItem
    {
        return WorkItem::findByReference($ref) ?? throw Problem::notFound();
    }

    /**
     * @template TModel of Model
     *
     * @param  class-string<TModel>  $class
     * @return TModel
     *
     * @throws Problem
     */
    public static function ulid(string $class, string $ref): Model
    {
        $model = Str::isUlid($ref) ? $class::query()->find(strtolower($ref)) : null;

        return $model instanceof $class ? $model : throw Problem::notFound();
    }
}
