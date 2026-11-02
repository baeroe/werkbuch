<?php

use App\Access\ProjectRole;
use App\Actions\Projects\DeleteProject;
use App\Actions\Projects\RemoveMember;
use App\Actions\Projects\UpdateProject;
use App\Actions\Search\QuerySearch;
use App\Actions\Users\DeactivateUser;
use App\Actions\WorkItems\DeleteWorkItem;
use App\Jobs\PurgeProject;
use App\Models\Project;
use App\Models\User;
use App\Models\View;
use App\Models\WorkItem;
use App\Search\SearchIndexer;
use App\Search\SearchResults;
use GuzzleHttp\Psr7\Response;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Exceptions;
use Illuminate\Support\Facades\Queue;
use Meilisearch\Exceptions\CommunicationException;
use Meilisearch\Exceptions\InvalidResponseBodyException;
use Psr\Http\Client\ClientExceptionInterface;

/** Mara, member of the public WEB („Website“); OPS („Betrieb“) is private and Mara is not in it. */
$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara Lindqvist']);
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Member)->create(['name' => 'Website']);
    $ops = Project::factory()->identifier('OPS')->private()->create(['name' => 'Betrieb']);

    return [$mara, $web, $ops];
};

$item = fn (Project $project, string $title, array $attributes = []): WorkItem => WorkItem::factory()->for($project)->create(['title' => $title, ...$attributes]);
$rebuild = fn () => app(SearchIndexer::class)->rebuild();
$search = fn (User $user, array $query): SearchResults => QuerySearch::run(actor($user), $query);
/** The keys of the models in their order. */
$ids = fn (Collection $models): array => array_values($models->map(fn (Model $model) => $model->getKey())->all());

/** The field errors of a refused search. */
$refusal = fn (User $user, array $query): array => invalidOf(fn () => QuerySearch::run(actor($user), $query));

// visibility (review focus 1)

it('finds items of the projects the reader sees and nothing of a private project', function () use ($world, $item, $rebuild, $search, $ids) {
    $engine = searchEngine();
    [$mara, $web, $ops] = $world();
    $inWeb = $item($web, 'Kontaktformular prüfen');
    $inOps = $item($ops, 'Kontaktformular sichern');
    $rebuild();

    $results = $search($mara, ['q' => 'kontaktformular']);

    expect($engine->documents('testing_work_items'))->toHaveKey($inOps->id)
        ->and($ids($results->items))->toBe([$inWeb->id])
        ->and($results->keyMatch)->toBeNull()
        ->and($ids($results->projects))->toBe([]);
});

it('finds items of a public project for a non-member', function () use ($world, $item, $rebuild, $search, $ids) {
    searchEngine();
    [, $web] = $world();
    $ida = User::factory()->create(['name' => 'Ida Brandt']);
    $inWeb = $item($web, 'Kontaktformular prüfen');
    $rebuild();

    expect($ids($search($ida, ['q' => 'kontaktformular'])->items))->toBe([$inWeb->id])
        ->and($ids($search($ida, ['q' => 'website'])->projects))->toBe([$web->id]);
});

it('shows no item the index still holds after it was deleted', function () use ($item, $rebuild, $search, $ids) {
    $engine = searchEngine();
    $mara = User::factory()->create();
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Admin)->create();
    $kept = $item($web, 'Kontaktformular prüfen');
    $gone = $item($web, 'Kontaktformular sichern');
    $rebuild();

    DeleteWorkItem::run(actor($mara), $gone);

    expect($engine->documents('testing_work_items'))->toHaveKey($gone->id)
        ->and($ids($search($mara, ['q' => 'kontaktformular'])->items))->toBe([$kept->id])
        ->and($search($mara, ['q' => 'WEB-2'])->keyMatch)->toBeNull();
});

it('shows no item of a project being deleted', function () use ($item, $rebuild, $search, $ids) {
    $engine = searchEngine();
    Queue::fake([PurgeProject::class]);
    $mara = User::factory()->create();
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Admin)->create(['name' => 'Website']);
    $inWeb = $item($web, 'Kontaktformular prüfen');
    $rebuild();

    DeleteProject::run(actor($mara), $web);

    $results = $search($mara, ['q' => 'kontaktformular', 'include_archived' => true]);
    expect($engine->documents('testing_work_items'))->toHaveKey($inWeb->id)
        ->and($engine->documents('testing_projects'))->toHaveKey($web->id)
        ->and($ids($results->items))->toBe([])
        ->and($ids($search($mara, ['q' => 'website', 'include_archived' => true])->projects))->toBe([])
        ->and($search($mara, ['q' => 'WEB-1'])->keyMatch)->toBeNull();
});

it('shows no item of a project the reader was removed from', function () use ($item, $rebuild, $search, $ids) {
    searchEngine();
    $admin = User::factory()->admin()->create();
    $mara = User::factory()->create();
    $ops = Project::factory()->identifier('OPS')->private()->member($mara, ProjectRole::Member)->create(['name' => 'Betrieb', 'lead_id' => $admin->id]);
    $inOps = $item($ops, 'Kontaktformular sichern');
    $rebuild();
    expect($ids($search($mara, ['q' => 'kontaktformular'])->items))->toBe([$inOps->id]);

    RemoveMember::run(actor($admin), $ops, $mara);

    $results = $search($mara, ['q' => 'kontaktformular']);
    expect($ids($results->items))->toBe([])
        ->and($ids($search($mara, ['q' => 'betrieb'])->projects))->toBe([])
        ->and($search($mara, ['q' => 'OPS-1'])->keyMatch)->toBeNull();
});

it('finds nothing for a deactivated account', function () use ($world, $item, $rebuild, $search, $ids) {
    searchEngine();
    [$mara, $web] = $world();
    $admin = User::factory()->admin()->create();
    $inWeb = $item($web, 'Kontaktformular prüfen');
    $rebuild();
    expect($ids($search($mara, ['q' => 'kontaktformular'])->items))->toBe([$inWeb->id]);

    DeactivateUser::run(actor($admin), $mara);
    $mara = $mara->fresh();

    expect($ids($search($mara, ['q' => 'kontaktformular'])->items))->toBe([])
        ->and($ids($search($mara, ['q' => 'website'])->projects))->toBe([])
        ->and($search($mara, ['q' => 'WEB-1'])->keyMatch)->toBeNull();
});

// the archive (P3)

it('leaves archived items and the items of archived projects out unless include_archived', function () use ($world, $item, $rebuild, $search, $ids) {
    searchEngine();
    [$mara, $web] = $world();
    $arc = Project::factory()->identifier('ARC')->archived()->member($mara, ProjectRole::Member)->create(['name' => 'Altes Portal']);
    $open = $item($web, 'Kontakt offen');
    $archived = WorkItem::factory()->for($web)->archived()->create(['title' => 'Kontakt archiviert']);
    $inArc = $item($arc, 'Kontakt alt');
    $rebuild();

    expect($ids($search($mara, ['q' => 'kontakt'])->items))->toBe([$open->id])
        ->and($ids($search($mara, ['q' => 'kontakt', 'include_archived' => '1'])->items))->toBe([$open->id, $archived->id, $inArc->id]);
});

it('lists archived projects only with include_archived', function () use ($world, $rebuild, $search, $ids) {
    $engine = searchEngine();
    [$mara, $web] = $world();
    $arc = Project::factory()->identifier('ARC')->archived()->member($mara, ProjectRole::Member)->create(['name' => 'Website alt']);
    $rebuild();

    expect($ids($search($mara, ['q' => 'website'])->projects))->toBe([$web->id])
        ->and($ids($search($mara, ['q' => 'website', 'include_archived' => true])->projects))->toBe([$web->id, $arc->id]);

    // restored after its document was written (archived: true): the scope from the database decides, not the document
    DB::table('projects')->where('id', $arc->id)->update(['archived_at' => null]);

    expect($engine->documents('testing_projects')[$arc->id]['archived'])->toBeTrue()
        ->and($ids($search($mara, ['q' => 'website'])->projects))->toBe([$web->id, $arc->id]);
});

// the key jump (P4, review focus 2)

it('puts the item of a typed key first and names it in key_match', function () use ($world, $item, $rebuild, $search, $ids) {
    searchEngine();
    [$mara, $web] = $world();
    $other = $item($web, 'Folgefehler zu web-47');
    $typed = $item($web, 'Kontaktformular prüfen');
    DB::table('work_items')->where('id', $typed->id)->update(['number' => 47]);
    $rebuild();

    $results = $search($mara, ['q' => 'web-47']);

    expect($results->keyMatch)->toBe($typed->id)
        ->and($ids($results->items))->toBe([$typed->id, $other->id])
        ->and($results->items->first()->key)->toBe('WEB-47');
});

it('jumps over a former identifier only to items the reader sees', function () use ($item, $rebuild, $search, $ids) {
    searchEngine();
    $mara = User::factory()->create();
    $ida = User::factory()->create();
    $old = Project::factory()->identifier('OLD')->private()->member($mara, ProjectRole::Admin)->create(['name' => 'Kundenportal']);
    $typed = $item($old, 'Kontaktformular prüfen');
    DB::table('work_items')->where('id', $typed->id)->update(['number' => 12]);
    UpdateProject::run(actor($mara), $old, ['identifier' => 'NEW']);
    $rebuild();

    $results = $search($mara, ['q' => 'OLD-12']);
    expect($results->keyMatch)->toBe($typed->id)
        ->and($ids($results->items))->toBe([$typed->id])
        ->and($results->items->first()->key)->toBe('NEW-12');

    foreach (['OLD-12', 'NEW-12'] as $key) {
        $hidden = $search($ida, ['q' => $key]);
        expect($hidden->keyMatch)->toBeNull()->and($ids($hidden->items))->toBe([]);
    }
});

it('answers the key of an item the reader may not see like an unknown key', function () use ($world, $item, $rebuild) {
    $engine = searchEngine();
    [$mara, , $ops] = $world();
    $hidden = $item($ops, 'Geheimes Wartungsfenster');
    $rebuild();

    $hiddenKey = $this->actingAs($mara)->getJson('/api/v1/search?q=OPS-1')->assertOk();
    $unknownKey = $this->actingAs($mara)->getJson('/api/v1/search?q=ZZZ-1')->assertOk();

    expect($engine->documents('testing_work_items'))->toHaveKey($hidden->id)
        ->and($hiddenKey->json())->toBe($unknownKey->json())
        ->and($hiddenKey->json('data.key_match'))->toBeNull()
        ->and($hiddenKey->getContent())->not->toContain($hidden->id)->not->toContain('Wartungsfenster');
});

it('finds an archived item by its key without include_archived', function () use ($world, $rebuild, $search, $ids) {
    searchEngine();
    [$mara, $web] = $world();
    $archived = WorkItem::factory()->for($web)->archived()->create(['title' => 'Kontakt archiviert']);
    $rebuild();

    $results = $search($mara, ['q' => 'WEB-1']);

    expect($results->keyMatch)->toBe($archived->id)
        ->and($ids($results->items))->toBe([$archived->id])
        ->and($ids($search($mara, ['q' => 'kontakt'])->items))->toBe([]);
});

it('lists the key match once and keeps the limit', function () use ($world, $item, $rebuild, $search, $ids) {
    searchEngine();
    [$mara, $web] = $world();
    $other = $item($web, 'Nachfolger von web-2');
    $typed = $item($web, 'Kontaktformular prüfen');
    $rebuild();

    expect($ids($search($mara, ['q' => 'web-2'])->items))->toBe([$typed->id, $other->id])
        ->and($ids($search($mara, ['q' => 'web-2', 'limit' => 1])->items))->toBe([$typed->id])
        ->and($ids($search($mara, ['q' => 'nachfolger', 'limit' => '1'])->items))->toBe([$other->id]);
});

// the kinds of hits

it('finds projects by identifier, former identifier and name', function () use ($rebuild, $search, $ids) {
    searchEngine();
    $mara = User::factory()->create();
    $portal = Project::factory()->identifier('OLD')->member($mara, ProjectRole::Admin)->create(['name' => 'Kundenportal']);
    Project::factory()->identifier('WEB')->create(['name' => 'Website']);
    UpdateProject::run(actor($mara), $portal, ['identifier' => 'NEU']);
    $rebuild();

    foreach (['NEU', 'old', 'kundenportal'] as $q) {
        expect($ids($search($mara, ['q' => $q])->projects))->toBe([$portal->id]);
    }
});

it('finds people and bots, never deactivated accounts', function () use ($rebuild, $search, $ids) {
    searchEngine();
    $admin = User::factory()->admin()->create(['name' => 'Mara Lindqvist']);
    $person = User::factory()->create(['name' => 'Kira Lenz']);
    $bot = User::factory()->bot($admin)->create(['name' => 'Kira Assistenz']);
    User::factory()->disabled()->create(['name' => 'Kira Alt']);
    $late = User::factory()->create(['name' => 'Kira Später']);
    $rebuild();

    DeactivateUser::run(actor($admin), $late);

    expect($ids($search($admin, ['q' => 'kira'])->people))->toBe([$person->id, $bot->id]);
});

it('finds views by every word of their name, taking % and _ literally', function () use ($search) {
    searchEngine();
    $mara = User::factory()->create();
    foreach (['Offene Bugs', 'Bugs der Woche', '100% fertig', '100 Prozent fertig', 'a_b Liste', 'axb Liste'] as $name) {
        View::factory()->create(['name' => $name, 'created_by' => $mara->id]);
    }
    $names = fn (string $q, array $query = []): array => array_values($search($mara, ['q' => $q, ...$query])->views->map(fn (View $view) => $view->name)->all());

    expect($names('bugs offen'))->toBe(['Offene Bugs'])
        ->and($names('BUGS'))->toBe(['Bugs der Woche', 'Offene Bugs'])
        ->and($names('BUGS', ['limit' => 1]))->toBe(['Bugs der Woche'])
        ->and($names('100%'))->toBe(['100% fertig'])
        ->and($names('a_b'))->toBe(['a_b Liste'])
        ->and($names('woche montag'))->toBe([]);
});

it('searches only the types asked for', function () use ($world, $item, $rebuild, $search, $ids) {
    $engine = searchEngine();
    [$mara, $web] = $world();
    $shop = Project::factory()->identifier('SHOP')->create(['name' => 'Webshop']);
    $inWeb = $item($web, 'Web-Formular');
    View::factory()->create(['name' => 'Web-Bugs', 'created_by' => $mara->id]);
    User::factory()->create(['name' => 'Webster']);
    $rebuild();

    $projects = $search($mara, ['q' => 'web', 'types' => 'projects']);
    expect($ids($projects->projects))->toBe([$web->id, $shop->id])
        ->and($ids($projects->items))->toBe([])
        ->and($projects->people)->toBeEmpty()
        ->and($projects->views)->toBeEmpty()
        ->and($projects->keyMatch)->toBeNull()
        ->and($engine->searched())->toBe(['testing_projects']);

    $some = $search($mara, ['q' => 'web', 'types' => ['items', ' views ', ''], 'limit' => 1]);
    expect($ids($some->items))->toBe([$inWeb->id])
        ->and($some->projects)->toBeEmpty()
        ->and($some->views)->toHaveCount(1)
        ->and($engine->searched())->toBe(['testing_projects', 'testing_work_items'])
        ->and($ids($search($mara, ['q' => 'web', 'types' => 'projects,people', 'limit' => 1])->projects))->toBe([$web->id])
        ->and($search($mara, ['q' => 'web'])->people)->toHaveCount(1);
});

// the input

it('refuses an empty query, an unknown type, a limit outside 1–50 and a non-boolean include_archived in one answer', function () use ($refusal) {
    searchEngine();
    $mara = User::factory()->create();

    expect($refusal($mara, ['q' => '  ', 'types' => 'items,wiki', 'limit' => '51', 'include_archived' => 'ja']))->toBe([
        'q' => [__('field.q.required')],
        'types' => [__('field.types.unknown', ['name' => 'wiki', 'allowed' => 'items, projects, people, views'])],
        'limit' => [__('field.limit.invalid', ['max' => 50])],
        'include_archived' => [__('field.include_archived.invalid')],
    ])
        ->and($refusal($mara, []))->toBe(['q' => [__('field.q.required')]])
        ->and($refusal($mara, ['q' => ['kontakt']]))->toBe(['q' => [__('field.q.required')]])
        ->and($refusal($mara, ['q' => str_repeat('ä', 256)]))->toBe(['q' => [__('field.q.max', ['max' => 255])]])
        ->and($refusal($mara, ['q' => 'x', 'types' => ['items', 7]]))->toBe(['types' => [__('field.types.unknown', ['name' => 'int', 'allowed' => 'items, projects, people, views'])]])
        ->and($refusal($mara, ['q' => 'x', 'types' => 7]))->toBe(['types' => [__('field.types.unknown', ['name' => 'int', 'allowed' => 'items, projects, people, views'])]]);

    foreach (['0', 0, 'abc', '2.5', ['3'], true] as $limit) {
        expect($refusal($mara, ['q' => 'x', 'limit' => $limit]))->toBe(['limit' => [__('field.limit.invalid', ['max' => 50])]]);
    }

    $none = QuerySearch::run(actor($mara), ['q' => str_repeat('ä', 255), 'limit' => '50', 'include_archived' => null, 'types' => null, 'other' => 'x']);
    expect($none->items)->toBeEmpty();
});

it('lets the engine leave out what the reader may not get before it cuts at the limit', function () use ($world, $item, $search, $ids) {
    searchEngine();
    [$mara, $web, $ops] = $world();
    $arc = Project::factory()->identifier('ARC')->archived()->member($mara, ProjectRole::Member)->create(['name' => 'Kontakt Archiv']);
    $web->update(['name' => 'Kontakt Website']);
    $ops->update(['name' => 'Kontakt Betrieb']);
    $hidden = $item($ops, 'Kontakt geheim');
    $archived = WorkItem::factory()->for($web)->archived()->create(['title' => 'Kontakt archiviert']);
    $open = $item($web, 'Kontakt offen');
    $gone = User::factory()->disabled()->create(['name' => 'Kontakt Alt']);
    $active = User::factory()->create(['name' => 'Kontakt Lenz']);
    // what the reader may not get stands first in the index: only a filter in the engine leaves room for the rest
    $indexer = app(SearchIndexer::class);
    foreach ([$hidden, $archived, $open] as $indexed) {
        $indexer->upsertItem($indexed->id);
    }
    foreach ([$ops, $arc, $web] as $indexed) {
        $indexer->upsertProject($indexed->id);
    }
    foreach ([$gone, $active] as $indexed) {
        $indexer->upsertUser($indexed->id);
    }

    $results = $search($mara, ['q' => 'kontakt', 'limit' => 1]);

    expect($ids($results->items))->toBe([$open->id])
        ->and($ids($results->projects))->toBe([$web->id])
        ->and($ids($results->people))->toBe([$active->id]);
});

it('keeps the order of the index', function () use ($world, $item, $search, $ids) {
    searchEngine();
    [$mara, $web] = $world();
    $first = $item($web, 'Kontaktformular A');
    $second = $item($web, 'Kontaktformular B');
    $indexer = app(SearchIndexer::class);
    $indexer->upsertItem($second->id);
    $indexer->upsertItem($first->id);
    $indexer->upsertProject($web->id);

    expect($ids($search($mara, ['q' => '  kontaktformular '])->items))->toBe([$second->id, $first->id]);
});

it('answers 503 search_unavailable when the engine fails', function (Throwable $error) use ($world, $search) {
    Exceptions::fake();
    $engine = searchEngine();
    [$mara] = $world();
    $engine->failWith($error);

    $problem = problemOf(fn () => $search($mara, ['q' => 'kontakt']));

    expect($problem->status)->toBe(503)->and($problem->reason)->toBe('search_unavailable')->and($problem->detail)->toBeNull();
    Exceptions::assertReported($error::class);
})->with([
    'no connection' => fn () => new CommunicationException('down'),
    'a proxy page instead of JSON' => fn () => new InvalidResponseBodyException(new Response(502), '<html>Bad Gateway</html>'),
    'an error of the HTTP client' => fn () => new class('timeout') extends RuntimeException implements ClientExceptionInterface {},
]);

// the database

it('asks the database a fixed number of times', function () use ($world, $item, $rebuild) {
    searchEngine();
    [$mara, $web] = $world();
    $more = function (int $count) use ($web, $item, $mara, $rebuild) {
        foreach (range(1, $count) as $n) {
            $item($web, "Kontakt {$n}");
            Project::factory()->member($mara, ProjectRole::Member)->create(['name' => "Kontakt {$n}"]);
            User::factory()->create(['name' => "Kontakt {$n}"]);
            View::factory()->create(['name' => "Kontakt {$n}", 'created_by' => $mara->id]);
        }
        $rebuild();
    };
    $count = function () use ($mara): int {
        DB::flushQueryLog();
        DB::enableQueryLog();
        $this->actingAs($mara)->getJson('/api/v1/search?q=kontakt&limit=50')->assertOk();
        DB::disableQueryLog();

        return count(DB::getQueryLog());
    };

    $more(2);
    // the first request also reads what the app keeps for the rest of the test (the account, the organisation)
    $count();
    $few = $count();
    $more(18);

    expect($this->actingAs($mara)->getJson('/api/v1/search?q=kontakt&limit=50')->json('data.items'))->toHaveCount(20)
        ->and($count())->toBe($few);
});
