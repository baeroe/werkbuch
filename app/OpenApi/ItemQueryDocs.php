<?php

namespace App\OpenApi;

use App\Actions\WorkItems\CountWorkItems;
use App\Actions\WorkItems\GetWorkItem;
use App\Actions\WorkItems\GroupWorkItems;
use App\Domain\Views\GroupBy;
use App\Domain\Views\SortSpec;
use App\Http\Controllers\Api\WorkItemsController;
use App\Support\PageArgs;
use App\Views\ItemQueryInput;
use App\Views\Shorthand;
use Dedoc\Scramble\Extensions\OperationExtension;
use Dedoc\Scramble\Support\Generator\Operation;
use Dedoc\Scramble\Support\Generator\Parameter;
use Dedoc\Scramble\Support\Generator\Schema;
use Dedoc\Scramble\Support\RouteInfo;

/**
 * The queries of the work items, which run through the filter engine of the views and not through `ListSpec`: the
 * query string of `GET /work-items` (the view, the short form `filter[<key>]` of `Shorthand::KEYS`, the sort of
 * `SortSpec::fromQuery`, the flags and the page) and `include` of `GET /work-items/{item}` (`GetWorkItem::INCLUDES`), as
 * an operation extension; the bodies of `POST /work-items/query|groups|counts` (`ItemQueryInput::BODY_KEYS`,
 * `GroupWorkItems::KEYS`, `CountWorkItems::KEYS`) as the static methods `#[Body]` names. These bodies are closed: the
 * server refuses any other key (`field.query.unknown`); `null` is the same as a key left out.
 */
final class ItemQueryDocs extends OperationExtension
{
    /** A flag as Laravel's `boolean` reads it, in a query string. */
    private const QUERY_FLAG = ['type' => 'integer', 'enum' => [1, 0]];

    /** A flag of a body: `true`, `false`, `1`, `0`, `"1"`, `"0"` or `null` (left out). */
    private const FLAG = ['type' => ['boolean', 'integer', 'string', 'null'], 'enum' => [true, false, 1, 0, '1', '0', null]];

    /** The keys of the short form that take one value; every other one but `archived` takes a list. */
    private const SINGLE = ['project', 'parent', 'q'];

    /**
     * What the keys of the short form take. Never "separated by commas": in `GET /work-items` a key of several values is a
     * list (its parameter style says how a query string writes it), in the body's `shorthand` one text (its object says so).
     */
    private const SHORT = [
        'project' => 'The project: ULID, identifier or a former identifier (one the account does not see is 404).',
        'parent' => 'The parent: ULID or key (one the account does not see is 404).',
        'q' => 'Words of the title, or the key of an item the account sees.',
        'assignee' => '`me`, `none` or ULIDs.',
        'created_by' => '`me`, `none` or ULIDs.',
        'type' => 'Type ULIDs.',
        'state' => 'State ULIDs.',
        'state_category' => 'State categories (`backlog`, `unstarted`, `started`, `completed`, `canceled`).',
        'priority' => 'Priorities (`urgent`, `high`, `medium`, `low`, `none`).',
        'label' => 'Label ULIDs.',
        'archived' => 'Only archived (`true`) or only not archived (`false`) items.',
    ];

    public function handle(Operation $operation, RouteInfo $routeInfo): void
    {
        if ($routeInfo->className() !== WorkItemsController::class) {
            return;
        }

        $parameters = match ($routeInfo->methodName()) {
            'index' => self::listParameters(),
            'show' => [self::parameter('include', self::includeParameter()['schema'], self::includeParameter()['description'])->setStyle('form')->setExplode(false)],
            default => [],
        };
        if ($parameters === []) {
            return;
        }

        $names = array_map(fn (Parameter $parameter) => $parameter->name, $parameters);
        // what Scramble guessed from the controller (`include` as a text) gives way
        $operation->parameters = array_values(array_filter($operation->parameters, fn (mixed $parameter) => ! $parameter instanceof Parameter
            || $parameter->in !== 'query' || ! in_array($parameter->name, $names, true)));
        $operation->addParameters($parameters);
    }

    /**
     * @return list<Parameter>
     */
    private static function listParameters(): array
    {
        $parameters = [];
        foreach (self::queryParameters() as $name => ['schema' => $schema, 'description' => $description]) {
            $parameter = self::parameter($name, $schema, $description);
            // a list goes in one parameter, separated by commas (as ListParameters says it)
            $parameters[] = $schema['type'] === 'array' ? $parameter->setStyle('form')->setExplode(false) : $parameter;
        }

        return $parameters;
    }

    /**
     * The query of `GET /work-items` by name: its schema and what it does. A key of the short form that takes several
     * values is a list (in a query string separated by commas); the page is that of every list (`ListParameters`).
     *
     * @return array<string, array{schema: array<string, mixed>, description: string}>
     */
    public static function queryParameters(): array
    {
        $parameters = ['view' => ['schema' => ['type' => 'string', 'pattern' => PathParameters::ULID], 'description' => 'A view by its ULID: its filter, sort and sub-items apply, the rest narrows them.']];

        foreach (Shorthand::KEYS as $key) {
            $schema = match (true) {
                $key === 'archived' => ['type' => 'string', 'enum' => ['true', 'false']],
                in_array($key, self::SINGLE, true) => ['type' => 'string'],
                default => ['type' => 'array', 'items' => ['type' => 'string']],
            };
            $parameters["filter[{$key}]"] = ['schema' => $schema, 'description' => self::SHORT[$key]];
        }
        $page = ListParameters::query(null);

        return [
            ...$parameters,
            'sort' => ['schema' => ['type' => 'string'], 'description' => 'The order: '.implode(', ', array_map(fn (string $field) => "`{$field}`", SortSpec::CORE))
                .' or `property:<key>` (number, date, text, address); `-` before it sorts descending (`-due_date`). Default: the sort of the view, else `rank`.'],
            'show_sub_items' => ['schema' => self::QUERY_FLAG, 'description' => 'Whether items with a parent show (`1`) or not (`0`); by default as the view says, else `1`.'],
            'include_archived' => ['schema' => self::QUERY_FLAG, 'description' => 'Archived items and items of archived projects too (`1`).'],
            'lean' => ['schema' => self::QUERY_FLAG, 'description' => 'Lean items (`1`): without `description`, `description_json` and `values_markdown`.'],
            'cursor' => $page['cursor'],
            'per_page' => $page['per_page'],
        ];
    }

    /**
     * `include` of `GET /work-items/{item}`: its schema and what it does.
     *
     * @return array{schema: array<string, mixed>, description: string}
     */
    public static function includeParameter(): array
    {
        return [
            'schema' => ['type' => 'array', 'items' => ['type' => 'string', 'enum' => GetWorkItem::INCLUDES]],
            'description' => 'What to embed: '.implode(', ', array_map(fn (string $name) => "`{$name}`", GetWorkItem::INCLUDES)).'. '
                .'`children` holds the first '.GetWorkItem::CHILDREN_MAX.' children in manual order, archived ones included; '
                .'`children_progress.total` counts them all; the item list with the item as parent, archived ones included, has the rest in the same order.',
        ];
    }

    /**
     * The body of `POST /work-items/query`.
     *
     * @return array<string, mixed>
     */
    public static function query(): array
    {
        return self::body(
            'A read through a body (a read-only token may send it): the same page of items as `GET /work-items`. The filter, the short form, '
                .'the search and the view all hold together. Any other key is 422 `field.query.unknown`.',
            ItemQueryInput::BODY_KEYS,
        );
    }

    /**
     * The body of `POST /work-items/groups`.
     *
     * @return array<string, mixed>
     */
    public static function groups(): array
    {
        return self::body(
            'The groups of a query and their numbers (a read). Any other key (the short form, `group`, a page, `lean`) is 422 `field.query.unknown`.',
            GroupWorkItems::KEYS,
            ['group_by'],
        );
    }

    /**
     * The body of `POST /work-items/counts`.
     *
     * @return array<string, mixed>
     */
    public static function counts(): array
    {
        return [
            'type' => 'object',
            'description' => 'The number of items of each named filter (a read). A filter on something the account does not see counts 0.',
            'properties' => [
                'filters' => [
                    'type' => 'object',
                    'description' => '1–'.CountWorkItems::MAX_FILTERS.' filters by name (letters, digits, `_`, `.`, `:`, `-`; at most 64 characters), '
                        .'with at most '.CountWorkItems::MAX_CONDITIONS_TOTAL.' conditions over all of them together (else 422 `field.filters.too_many` at `filters`).',
                    'minProperties' => 1,
                    'maxProperties' => CountWorkItems::MAX_FILTERS,
                    'propertyNames' => ['pattern' => '^[A-Za-z0-9_.:-]{1,64}$'],
                    'additionalProperties' => ['$ref' => '#/components/schemas/Filter'],
                ],
                'include_archived' => [...self::FLAG, 'description' => 'For every filter: archived items and items of archived projects too.'],
            ],
            'required' => ['filters'],
        ];
    }

    /**
     * @param  list<string>  $keys
     * @param  list<string>  $required
     * @return array<string, mixed>
     */
    private static function body(string $description, array $keys, array $required = []): array
    {
        $nullable = fn (array $schema): array => ['anyOf' => [$schema, ['type' => 'null']]];
        $all = [
            'view_id' => ['type' => ['string', 'null'], 'description' => 'A view by its ULID; an unknown one is 404.'],
            'filter' => $nullable(['$ref' => '#/components/schemas/Filter']),
            'shorthand' => [
                'type' => ['object', 'null'],
                'description' => 'The short form of `filter[…]` of `GET /work-items` as an object of texts: several values are one text separated by commas, never a list.',
                'properties' => array_map(fn (string $text) => ['type' => ['string', 'null'], 'description' => $text], self::SHORT),
            ],
            'q' => ['type' => ['string', 'null'], 'description' => 'Words of the title, or a key (not together with `shorthand.q`).'],
            'sort' => $nullable(['$ref' => '#/components/schemas/SortSpec']),
            'show_sub_items' => [...self::FLAG, 'description' => 'Whether items with a parent show; by default as the view says, else `true`.'],
            'group_by' => [
                'type' => ['string', 'null'], 'enum' => [...array_column(GroupBy::cases(), 'value'), null],
                'description' => 'The grouping (`group` needs it).',
            ],
            'group' => ['type' => ['string', 'null'], 'description' => 'Only the items of this group of `group_by` (a key of `POST /work-items/groups`).'],
            'include_archived' => [...self::FLAG, 'description' => 'Archived items and items of archived projects too.'],
            'lean' => [...self::FLAG, 'description' => 'Lean items: without `description`, `description_json` and `values_markdown`.'],
            'cursor' => ['type' => ['string', 'null'], 'description' => '`meta.next_cursor` of the page before (a list read by POST has no `links.next`).'],
            'per_page' => ['type' => ['integer', 'null'], 'minimum' => 1, 'maximum' => PageArgs::MAX_PER_PAGE, 'default' => PageArgs::MAX_PER_PAGE],
        ];

        return array_filter([
            'type' => 'object',
            'description' => $description,
            'properties' => array_intersect_key($all, array_flip($keys)),
            'required' => $required ?: null,
        ], fn (mixed $value) => $value !== null);
    }

    /**
     * @param  array<string, mixed>  $schema
     */
    private static function parameter(string $name, array $schema, string $description): Parameter
    {
        return Parameter::make($name, 'query')->setSchema(Schema::fromType(new JsonSchema($schema)))->description($description);
    }
}
