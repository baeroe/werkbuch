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

        $parameters = [
            self::parameter('cursor', ['type' => 'string'], 'The cursor of the page: `meta.next_cursor` or `meta.prev_cursor` of the page before. '
                .'It belongs to its list and its sort; another one is 422 at `cursor`.'),
            self::parameter('per_page', ['type' => 'integer', 'default' => PageArgs::MAX_PER_PAGE, 'minimum' => 1, 'maximum' => PageArgs::MAX_PER_PAGE],
                'The rows per page.'),
        ];

        $spec = $listOf->spec();
        if ($spec !== null && ! $spec->fixed) {
            foreach ($spec->filters as $filter) {
                $parameters[] = self::filter($filter);
            }
            if ($spec->sortable && $spec->sorts !== []) {
                $parameters[] = self::parameter('sort', ['type' => 'string'], self::sortDescription($spec));
            }
            if ($spec->includes !== []) {
                $parameters[] = self::parameter('include', self::listOf($spec->includes), 'Relations to load with each row, separated by commas.')
                    ->setStyle('form')->setExplode(false);
            }
        }

        $operation->addParameters($parameters);
    }

    private static function filter(ListFilter $filter): Parameter
    {
        $name = 'filter['.$filter->name.']';

        return match ($filter->type) {
            'boolean' => self::parameter($name, ['type' => 'integer', 'enum' => [1, 0]], 'Only rows where it is true (`1`) or false (`0`).'),
            'string' => self::parameter($name, ['type' => 'string'], $filter->kind === ListFilter::PARTIAL
                ? 'Only rows whose '.str_replace('_', ' ', $filter->column).' contains the text (any case; a comma is part of the text).'
                : 'Only rows that match the text.'),
            default => self::parameter($name, self::listOf($filter->values), 'Only rows with one of the values, separated by commas.')
                ->setStyle('form')->setExplode(false),
        };
    }

    private static function sortDescription(ListSpec $spec): string
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

    /**
     * @param  array<string, mixed>  $schema
     */
    private static function parameter(string $name, array $schema, string $description): Parameter
    {
        return Parameter::make($name, 'query')->setSchema(Schema::fromType(new JsonSchema($schema)))->description($description);
    }
}
