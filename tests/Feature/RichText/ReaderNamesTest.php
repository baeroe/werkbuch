<?php

use App\Access\ProjectRole;
use App\Models\Page;
use App\Models\Project;
use App\Models\User;
use App\Support\ReaderNames;
use Illuminate\Support\Facades\DB;
use Tests\Support\RichTextFixtures as F;

/** Ida is a member of WEB; OPS is private and Ida is not in it. */
$world = function (): array {
    $ida = User::factory()->create(['handle' => 'ida']);
    $web = Project::factory()->identifier('WEB')->member($ida, ProjectRole::Member)->create();
    $ops = Project::factory()->identifier('OPS')->private()->create();

    return [$ida, $web, $ops];
};

it('names the pages the reader sees with their title and identifier, with one query for all texts', function () use ($world) {
    [$ida, $web, $ops] = $world();
    [$first, $second] = Page::factory()->for($web)->count(2)->create()->all();
    $hidden = Page::factory()->for($ops)->create();
    $deleting = Page::factory()->for(Project::factory()->public()->member($ida, ProjectRole::Member)->create(['deleting_at' => now()]))->create();
    $texts = [
        F::doc(F::p(F::reference($first->id, 'page'), F::reference($hidden->id, 'page'))),
        F::doc(F::p(F::reference($second->id, 'page'), F::reference($first->id, 'page'), F::reference($deleting->id, 'page'))),
    ];
    ReaderNames::of([F::doc(F::p(F::reference($first->id, 'page')))], $ida);
    $queries = [];
    DB::listen(function ($query) use (&$queries): void {
        $queries[] = $query->sql;
    });

    $names = ReaderNames::of($texts, $ida);

    expect($names->pages)->toEqualCanonicalizing([
        $first->id => ['title' => $first->title, 'identifier' => 'WEB'],
        $second->id => ['title' => $second->title, 'identifier' => 'WEB'],
    ])
        ->and($names->items)->toBe([])
        ->and(collect($queries)->filter(fn (string $sql) => str_contains($sql, 'from `pages`'))->count())->toBe(1);
});

it('asks nothing for texts without references and nothing about pages for texts without page references', function () use ($world) {
    [$ida] = $world();
    $queries = 0;
    DB::listen(function () use (&$queries): void {
        $queries++;
    });

    $names = ReaderNames::of([F::doc(F::p('Nur Text'))], $ida);

    expect($queries)->toBe(0)
        ->and($names->pages)->toBe([]);
});
