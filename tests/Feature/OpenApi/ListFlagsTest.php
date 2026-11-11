<?php

use App\Actions\Projects\ListProjects;
use App\Actions\Templates\ListTemplates;
use Tests\Support\OpenApi\Document;

/*
 * The flags of a list that are no filter (Final-Review I1), held by its `ListSpec` (`flags`): `include_archived` of
 * `GET /projects` and `lean` of both template lists. The actions read them from the query, so a client generated from the document has to
 * be able to send them, as `1` or `0` like every other flag of the query. And what the real document says of a text
 * filter (the lists of ListParametersTest have an API of their own, whose columns are the names).
 */

it('names the flags that the ListSpec of a list holds', function (string $path, string $flag, string $words) {
    $parameter = collect(Document::operation('GET', $path)['parameters'])->firstWhere('name', $flag);

    expect($parameter['in'])->toBe('query')
        ->and($parameter['required'] ?? false)->toBeFalse()
        ->and($parameter['schema'])->toBe(['type' => 'integer', 'enum' => [1, 0]])
        ->and($parameter['description'])->toContain($words);
})->with([
    'archived projects' => ['/projects', 'include_archived', 'Archived projects'],
    'lean templates' => ['/templates', 'lean', 'description'],
    'lean templates of a project' => ['/projects/{project}/templates', 'lean', 'description'],
]);

it('names no other parameter of these lists than the page, the spec and the flag', function (string $path, string $flag, array $spec) {
    $names = collect(Document::operation('GET', $path)['parameters'])->where('in', 'query')->pluck('name')->all();

    expect($names)->toEqualCanonicalizing(['cursor', 'per_page', $flag, ...$spec]);
})->with([
    'projects' => ['/projects', 'include_archived', [
        ...array_map(fn ($filter) => "filter[{$filter->name}]", array_values(ListProjects::spec(null)->filters)), 'sort', 'include',
    ]],
    'templates' => ['/templates', 'lean', [
        ...array_map(fn ($filter) => "filter[{$filter->name}]", array_values(ListTemplates::spec()->filters)), 'sort',
    ]],
    'templates of a project' => ['/projects/{project}/templates', 'lean', [
        ...array_map(fn ($filter) => "filter[{$filter->name}]", array_values(ListTemplates::projectSpec()->filters)), 'sort',
    ]],
]);

it('names a text filter by its name, never by the column the query reads', function () {
    $name = collect(Document::operation('GET', '/relation-types')['parameters'])->firstWhere('name', 'filter[name]');

    expect($name['description'])->toBe('Only rows whose `name` contains the text (any case; a comma is part of the text).');
});
