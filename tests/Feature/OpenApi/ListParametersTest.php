<?php

use App\OpenApi\ListParameters;
use App\Support\ListFilter;
use Dedoc\Scramble\Generator;
use Dedoc\Scramble\Scramble;
use Illuminate\Routing\Route as RoutingRoute;
use Illuminate\Support\Facades\Route;
use Tests\Support\OpenApi\ListOfAction;
use Tests\Support\OpenApi\ListOfController;

/*
 * What the document says about a list (A386): its page (`cursor`, `per_page`), the filters, sorts and includes of its
 * `ListSpec` (`#[ListOf]`, `ListParameters`) and the shape of `ApiList::respond` (`ApiListReturnType`, `ApiListSchema`).
 * The routes of the test have an API of their own (`list-test`), never the document of `Document::get()` (K3).
 */

$generate = function (): array {
    Route::middleware('api')->prefix('api/v1')->group(function () {
        Route::get('_t/list/full', [ListOfController::class, 'full']);
        Route::get('_t/list/fixed', [ListOfController::class, 'fixed']);
        Route::get('_t/list/flagged', [ListOfController::class, 'flagged']);
        Route::get('_t/list/plain', [ListOfController::class, 'plain']);
        Route::get('_t/list/none', [ListOfController::class, 'none']);
    });
    $config = Scramble::registerApi('list-test')->routes(fn (RoutingRoute $route) => str_starts_with($route->uri(), 'api/v1/_t/list/'));

    return app(Generator::class)->generate($config)->spec($config->openApiVersion());
};

/**
 * The query parameters of an operation, by name.
 *
 * @return array<string, array<string, mixed>>
 */
$parameters = fn (array $document, string $path): array => collect($document['paths'][$path]['get']['parameters'] ?? [])
    ->where('in', 'query')->keyBy('name')->all();

it('documents the flags a spec names as 1 or 0 after the page and the filters', function () use ($generate, $parameters) {
    $flagged = $parameters($generate(), '/_t/list/flagged');

    expect(array_keys($flagged))->toBe(['cursor', 'per_page', 'filter[name]', 'sort', 'with_hidden'])
        ->and($flagged['with_hidden']['schema'])->toBe(['type' => 'integer', 'enum' => [1, 0]])
        ->and($flagged['with_hidden']['description'])->toBe('Hidden rows too (`1`).')
        ->and($flagged['with_hidden']['required'] ?? false)->toBeFalse();
});

it('documents the filters, sorts and includes of a list from its spec', function () use ($generate, $parameters) {
    $document = $generate();
    $full = $parameters($document, '/_t/list/full');

    expect(array_keys($full))->toBe([
        'cursor', 'per_page', 'filter[type]', 'filter[owner_id]', 'filter[name]', 'filter[disabled]', 'filter[kind]',
        'filter[member]', 'filter[handle]', 'sort', 'include',
    ])
        ->and($full['cursor']['schema'])->toBe(['type' => 'string'])
        ->and($full['per_page']['schema'])->toBe(['type' => 'integer', 'default' => 100, 'minimum' => 1, 'maximum' => 100])
        // an exact filter takes one value or several separated by commas
        ->and($full['filter[type]'])->toMatchArray(['explode' => false, 'style' => 'form'])
        ->and($full['filter[type]']['schema'])->toBe(['type' => 'array', 'items' => ['type' => 'string', 'enum' => ['person', 'bot']]])
        ->and($full['filter[owner_id]']['schema'])->toBe(['type' => 'array', 'items' => ['type' => 'string']])
        ->and($full['filter[name]']['schema'])->toBe(['type' => 'string'])
        ->and($full['filter[name]']['description'])->toContain('contains')
        // a boolean as Laravel reads it: 1 or 0
        ->and($full['filter[disabled]']['schema'])->toBe(['type' => 'integer', 'enum' => [1, 0]])
        ->and($full['filter[member]']['schema'])->toBe(['type' => 'integer', 'enum' => [1, 0]])
        ->and($full['filter[kind]']['schema'])->toBe(['type' => 'array', 'items' => ['type' => 'string']])
        ->and($full['filter[handle]']['schema'])->toBe(['type' => 'string'])
        ->and($full['sort']['schema'])->toBe(['type' => 'string'])
        ->and($full['sort']['description'])->toContain('`name`')->toContain('`created_at`')->toContain('`-`')->toContain('Default: `-created_at`.')
        ->and($full['include']['schema'])->toBe(['type' => 'array', 'items' => ['type' => 'string', 'enum' => ['members', 'owner']]])
        ->and($full['include'])->toMatchArray(['explode' => false, 'style' => 'form']);

    foreach ($full as $parameter) {
        expect($parameter['required'] ?? false)->toBeFalse();
    }

    // a fixed list and a class without rules of a list take only the page; a method without #[ListOf] nothing
    expect(array_keys($parameters($document, '/_t/list/fixed')))->toBe(['cursor', 'per_page'])
        ->and(array_keys($parameters($document, '/_t/list/plain')))->toBe(['cursor', 'per_page'])
        ->and($parameters($document, '/_t/list/none'))->toBe([]);
});

it('documents the list shape for ApiList::respond', function () use ($generate) {
    $document = $generate();
    $response = $document['paths']['/_t/list/full']['get']['responses']['200'];

    expect($response['content']['application/json']['schema'])->toBe([
        'type' => 'object',
        'properties' => [
            'data' => ['type' => 'array', 'items' => ['$ref' => '#/components/schemas/LabelResource']],
            'links' => ['$ref' => '#/components/schemas/ListLinks'],
            'meta' => ['$ref' => '#/components/schemas/ListMeta'],
        ],
        'required' => ['data', 'links', 'meta'],
    ])
        ->and($response['description'])->toBe('A page of `LabelResource`.')
        ->and($document['components']['schemas']['ListMeta']['required'])->toContain('total')
        ->and($document['components']['schemas'])->toHaveKey('LabelResource');
});

it('gives the schema of a filter value', function () use ($generate, $parameters) {
    $full = $parameters($generate(), '/_t/list/full');
    $spec = ListOfAction::spec();

    expect(ListParameters::filterSchema(ListFilter::exact('type', values: ['person', 'bot'])))
        ->toBe(['type' => 'array', 'items' => ['type' => 'string', 'enum' => ['person', 'bot']]])
        ->and(ListParameters::filterSchema(ListFilter::partial('name')))->toBe(['type' => 'string'])
        ->and(ListParameters::filterSchema(ListFilter::boolean('disabled')))->toBe(['type' => 'integer', 'enum' => [1, 0]]);

    // the same schema and description the document shows, and the sort as it describes it
    foreach ($spec->filters as $filter) {
        expect(ListParameters::filterSchema($filter))->toBe($full['filter['.$filter->name.']']['schema'], $filter->name)
            ->and(ListParameters::filterDescription($filter))->toBe($full['filter['.$filter->name.']']['description'], $filter->name);
    }
    expect(ListParameters::sortDescription($spec))->toBe($full['sort']['description']);
});
