<?php

namespace App\OpenApi;

use App\Http\Api\ListOf;
use App\Support\ListFilter;
use App\Support\ListSpec;
use App\Support\PageArgs;
use Dedoc\Scramble\Extensions\OperationExtension;
use Dedoc\Scramble\Support\Generator\Operation;
use Dedoc\Scramble\Support\Generator\Parameter;
use Dedoc\Scramble\Support\Generator\Schema;
use Dedoc\Scramble\Support\RouteInfo;

/**
 * The query of a list (A386), read from the `ListSpec` its controller method names (`#[ListOf]`): the page (`cursor`,
 * `per_page`) and, unless the list is fixed, `filter[<name>]` per filter, `sort` and `include`. A method without
 * `#[ListOf]` gets nothing from here.
 *
 * Lists of values go in one parameter separated by commas (`style: form`, `explode: false`); a boolean is `1` or `0`,
 * as Laravel's `boolean` reads it.
 */
final class ListParameters extends OperationExtension
{
    public function handle(Operation $operation, RouteInfo $routeInfo): void
    {
        $listOf = ($routeInfo->reflectionMethod()?->getAttributes(ListOf::class)[0] ?? null)?->newInstance();
        if ($listOf === null) {
            return;
        }

        $parameters = [];
        foreach (self::query($listOf->spec()) as $name => ['schema' => $schema, 'description' => $description]) {
            $parameter = Parameter::make($name, 'query')->setSchema(Schema::fromType(new JsonSchema($schema)))->description($description);
            // a list goes in one parameter, separated by commas
            $parameters[] = $schema['type'] === 'array' ? $parameter->setStyle('form')->setExplode(false) : $parameter;
        }

        $operation->addParameters($parameters);
    }

    /**
     * The query of a list by name: the page and, unless the list is fixed (or has no spec), `filter[<name>]` per filter,
     * `sort` and `include`; the same for the document and for an MCP tool (`ToolSchema::list`).
     *
     * @return array<string, array{schema: array<string, mixed>, description: string}>
     */
    public static function query(?ListSpec $spec): array
    {
        $query = [
            'cursor' => ['schema' => ['type' => 'string'], 'description' => 'The cursor of the page: `meta.next_cursor` or `meta.prev_cursor` of the page before. '
                .'It belongs to its list and its sort; another one is 422 at `cursor`.'],
            'per_page' => ['schema' => ['type' => 'integer', 'default' => PageArgs::MAX_PER_PAGE, 'minimum' => 1, 'maximum' => PageArgs::MAX_PER_PAGE],
                'description' => 'The rows per page.'],
        ];

        if ($spec === null || $spec->fixed) {
            return $query;
        }

        foreach ($spec->filters as $filter) {
            $query['filter['.$filter->name.']'] = ['schema' => self::filterSchema($filter), 'description' => self::filterDescription($filter)];
        }
        if ($spec->sortable && $spec->sorts !== []) {
            $query['sort'] = ['schema' => ['type' => 'string'], 'description' => self::sortDescription($spec)];
        }
        if ($spec->includes !== []) {
            $query['include'] = ['schema' => self::listOf($spec->includes), 'description' => 'Relations to load with each row, separated by commas.'];
        }

        return $query;
    }

    /**
     * The JSON Schema of the value of a filter: a boolean as `1` or `0`, a text, or a list of values (in a query string
     * separated by commas).
     *
     * @return array<string, mixed>
     */
    public static function filterSchema(ListFilter $filter): array
    {
        return match ($filter->type) {
            'boolean' => ['type' => 'integer', 'enum' => [1, 0]],
            'string' => ['type' => 'string'],
            default => self::listOf($filter->values),
        };
    }

    /** What the value of a filter does. */
    public static function filterDescription(ListFilter $filter): string
    {
        return match ($filter->type) {
            'boolean' => 'Only rows where it is true (`1`) or false (`0`).',
            'string' => $filter->kind === ListFilter::PARTIAL
                ? 'Only rows whose `'.$filter->name.'` contains the text (any case; a comma is part of the text).'
                : 'Only rows that match the text.',
            default => 'Only rows with one of the values, separated by commas.',
        };
    }

    /** What `sort` takes: the names of the spec, `-` for descending, and the default order. */
    public static function sortDescription(ListSpec $spec): string
    {
        $names = implode(', ', array_map(fn (string $name) => '`'.$name.'`', array_keys($spec->sorts)));
        $default = $spec->default === [] ? 'the ULID' : implode(', ', array_map(fn (string $name) => '`'.$name.'`', $spec->default));

        return "The order: {$names}, several separated by commas; `-` before a name sorts descending. Rows of equal value "
            ."follow their ULID. Default: {$default}.";
    }

    /**
     * @param  list<string>|null  $values
     * @return array<string, mixed>
     */
    private static function listOf(?array $values): array
    {
        return ['type' => 'array', 'items' => $values === null ? ['type' => 'string'] : ['type' => 'string', 'enum' => $values]];
    }
}
