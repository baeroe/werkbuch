<?php

use App\Access\ProjectRole;
use App\Access\Visibility;
use App\Actions\Projects\DeleteProject;
use App\Actions\Projects\RemoveMember;
use App\Actions\Projects\UpdateProject;
use App\Actions\Search\QuerySearch;
use App\Actions\Users\DeactivateUser;
use App\Actions\WorkItems\DeleteWorkItem;
use App\Jobs\PurgeProject;
use App\Models\Label;
use App\Models\Page;
use App\Models\Project;
use App\Models\User;
use App\Models\View;
use App\Models\WorkItem;
use App\Models\WorkItemType;
use App\Search\SearchIndexer;
use App\Search\SearchResults;
use GuzzleHttp\Psr7\Response;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Exceptions;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
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

// pages (A317)

it('finds a page by a word of its text, only in projects the reader sees', function () use ($world, $rebuild, $search, $ids) {
    $engine = searchEngine();
    [$mara, $web, $ops] = $world();
    $page = Page::factory()->for($web)->withText('Der Ablauf am ersten Tag')->create(['title' => 'Onboarding']);
    $titled = Page::factory()->for($web)->create(['title' => 'Ablauf der Releases']);
    $hidden = Page::factory()->for($ops)->withText('Der Ablauf der Wartung')->create(['title' => 'Geheim']);
    $rebuild();

    $results = $search($mara, ['q' => 'ablauf']);
    $response = $this->actingAs($mara)->getJson('/api/v1/search?q=ablauf&types=pages')->assertOk();

    expect($engine->documents('testing_pages'))->toHaveKey($hidden->id)
        ->and($ids($results->pages))->toEqualCanonicalizing([$page->id, $titled->id])
        ->and($ids($search($mara, ['q' => 'ersten tag'])->pages))->toBe([$page->id])
        ->and($response->json('data.pages.*.id'))->toEqualCanonicalizing([$page->id, $titled->id])
        // lean: the text stays on the page, and the title of the hidden page never leaves the server
        ->and($response->json('data.pages.0'))->toHaveKeys(['title', 'emoji', 'parent_id', 'version'])->not->toHaveKeys(['content', 'content_json'])
        ->and($response->getContent())->not->toContain('Geheim')
        ->and($ids($search($mara, ['q' => 'ablauf', 'types' => 'items'])->pages))->toBe([]);
});

it('reads the pages it found without their text (T9-M1)', function () use ($world, $rebuild, $search) {
    searchEngine();
    [$mara, $web] = $world();
    Page::factory()->for($web)->withText('Der Ablauf am ersten Tag')->create(['title' => 'Ablauf']);
    $rebuild();

    $page = $search($mara, ['q' => 'ablauf'])->pages->sole();

    expect(array_keys($page->getAttributes()))->toEqualCanonicalizing(Page::LEAN_COLUMNS);
});

it('shows no page the index still holds after it was deleted or its project is being deleted', function () use ($world, $rebuild, $search, $ids) {
    searchEngine();
    [$mara, $web] = $world();
    $gone = Page::factory()->for($web)->create(['title' => 'Ablauf alt']);
    $kept = Page::factory()->for($web)->create(['title' => 'Ablauf neu']);
    $rebuild();

    DB::table('pages')->where('id', $gone->id)->delete();
    expect($ids($search($mara, ['q' => 'ablauf'])->pages))->toBe([$kept->id]);

    DB::table('projects')->where('id', $web->id)->update(['deleting_at' => now()]);
    Visibility::forget();
    expect($ids($search($mara, ['q' => 'ablauf'])->pages))->toBe([]);
});

it('leaves out pages of archived projects without include_archived', function () use ($world, $rebuild, $search, $ids) {
    searchEngine();
    [$mara, $web] = $world();
    $arc = Project::factory()->identifier('ARC')->archived()->member($mara, ProjectRole::Member)->create(['name' => 'Altes Portal']);
    $open = Page::factory()->for($web)->create(['title' => 'Ablauf offen']);
    $old = Page::factory()->for($arc)->create(['title' => 'Ablauf alt']);
    $rebuild();

    expect($ids($search($mara, ['q' => 'ablauf'])->pages))->toBe([$open->id])
        ->and($ids($search($mara, ['q' => 'ablauf', 'include_archived' => '1'])->pages))->toBe([$open->id, $old->id]);
});

it('lets the engine leave out hidden pages before take', function () use ($world, $search, $ids) {
    searchEngine();
    [$mara, $web, $ops] = $world();
    $arc = Project::factory()->identifier('ARC')->archived()->member($mara, ProjectRole::Member)->create();
    $hidden = Page::factory()->for($ops)->create(['title' => 'Ablauf geheim']);
    $archived = Page::factory()->for($arc)->create(['title' => 'Ablauf archiviert']);
    $open = Page::factory()->for($web)->create(['title' => 'Ablauf offen']);
    // what the reader may not get stands first in the index: only a filter in the engine leaves room for the rest
    $indexer = app(SearchIndexer::class);
    foreach ([$hidden, $archived, $open] as $indexed) {
        $indexer->upsertPage($indexed->id);
    }

    expect($ids($search($mara, ['q' => 'ablauf', 'limit' => 1])->pages))->toBe([$open->id]);
});

it('keeps the order of the index for pages', function () use ($world, $search, $ids) {
    searchEngine();
    [$mara, $web] = $world();
    $first = Page::factory()->for($web)->create(['title' => 'Ablauf A']);
    $second = Page::factory()->for($web)->create(['title' => 'Ablauf B']);
    $indexer = app(SearchIndexer::class);
    $indexer->upsertPage($second->id);
    $indexer->upsertPage($first->id);

    expect($ids($search($mara, ['q' => 'ablauf'])->pages))->toBe([$second->id, $first->id]);
});

it('asks the database as often for 50 hits as for 5', function () use ($world, $rebuild) {
    searchEngine();
    [$mara, $web] = $world();
    $more = function (int $count) use ($web, $rebuild) {
        Page::factory()->for($web)->withText('Ein Ablauf')->count($count)->create();
        $rebuild();
    };
    $count = function () use ($mara): int {
        DB::flushQueryLog();
        DB::enableQueryLog();
        $this->actingAs($mara)->getJson('/api/v1/search?q=ablauf&types=pages&limit=50')->assertOk();
        DB::disableQueryLog();

        return count(DB::getQueryLog());
    };

    $more(5);
    $count();
    $few = $count();
    $more(45);

    expect($this->actingAs($mara)->getJson('/api/v1/search?q=ablauf&types=pages&limit=50')->json('data.pages'))->toHaveCount(50)
        ->and($count())->toBe($few);
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
        ->and($projects->pages)->toBeEmpty()
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
        ->and($search($mara, ['q' => 'web'])->people)->toHaveCount(1)
        // only the ids come back from Meilisearch, never the documents with their texts (T12-M2)
        ->and(collect($engine->options())->pluck('attributesToRetrieve')->unique()->values()->all())->toBe([['id']]);
});

// the input

it('refuses an empty query, an unknown type, a limit outside 1–50 and a non-boolean include_archived in one answer', function () use ($refusal) {
    searchEngine();
    $mara = User::factory()->create();

    expect($refusal($mara, ['q' => '  ', 'types' => 'items,wiki', 'limit' => '51', 'include_archived' => 'ja']))->toBe([
        'q' => [__('field.q.required')],
        'types' => [__('field.types.unknown', ['name' => 'wiki', 'allowed' => 'items, pages, projects, people, views'])],
        'limit' => [__('field.limit.invalid', ['max' => 50])],
        'include_archived' => [__('field.include_archived.invalid')],
    ])
        ->and($refusal($mara, []))->toBe(['q' => [__('field.q.required')]])
        ->and($refusal($mara, ['q' => ['kontakt']]))->toBe(['q' => [__('field.q.required')]])
        ->and($refusal($mara, ['q' => str_repeat('ä', 256)]))->toBe(['q' => [__('field.q.max', ['max' => 255])]])
        ->and($refusal($mara, ['q' => 'x', 'types' => ['items', 7]]))->toBe(['types' => [__('field.types.unknown', ['name' => 'int', 'allowed' => 'items, pages, projects, people, views'])]])
        ->and($refusal($mara, ['q' => 'x', 'types' => 7]))->toBe(['types' => [__('field.types.unknown', ['name' => 'int', 'allowed' => 'items, pages, projects, people, views'])]]);

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

// the filters of items (phase 13, K13)

/**
 * Four items „Kontakt …“ in WEB, in this order in the index: A a task of Mara with the label UX, B a bug without an
 * assignee with SEO and completed, C a task without an assignee or label, D a bug of Erik with Design.
 */
$filtered = function () use ($world, $item, $rebuild): array {
    [$mara, $web] = $world();
    $erik = User::factory()->create(['name' => 'Erik Ende']);
    $type = fn (string $name): string => WorkItemType::query()->where('name', $name)->sole()->id;
    $label = fn (string $name): Label => Label::factory()->create(['name' => $name]);
    [$ux, $seo, $design] = [$label('UX'), $label('SEO'), $label('Design')];

    $a = $item($web, 'Kontakt A', ['type_id' => $type('Task'), 'assignee_id' => $mara->id]);
    $b = WorkItem::factory()->for($web)->closed()->create(['title' => 'Kontakt B', 'type_id' => $type('Bug')]);
    $c = $item($web, 'Kontakt C', ['type_id' => $type('Task')]);
    $d = $item($web, 'Kontakt D', ['type_id' => $type('Bug'), 'assignee_id' => $erik->id]);
    $a->labels()->attach($ux->id);
    $b->labels()->attach($seo->id);
    $d->labels()->attach($design->id);
    $rebuild();

    return compact('mara', 'erik', 'web', 'ux', 'seo', 'design', 'a', 'b', 'c', 'd') + ['task' => $type('Task'), 'bug' => $type('Bug')];
};

it('refuses types that name no kind', function () use ($world, $refusal, $search) {
    $engine = searchEngine();
    [$mara] = $world();
    $empty = ['types' => [__('field.types.empty', ['allowed' => 'items, pages, projects, people, views'])]];

    foreach ([[], [''], [null], ',', ' , ', ''] as $types) {
        expect($refusal($mara, ['q' => 'x', 'types' => $types]))->toBe($empty, (string) json_encode($types));
    }
    expect($engine->searched())->toBe([]);

    // without types, every kind is searched
    $search($mara, ['q' => 'x']);
    $search($mara, ['q' => 'x', 'types' => null]);
    expect($engine->searched())->toBe([...$index = ['testing_work_items', 'testing_pages', 'testing_projects', 'testing_users'], ...$index]);
});

it('narrows items by type, category, assignee and label', function () use ($filtered, $search, $ids) {
    $engine = searchEngine();
    ['mara' => $mara, 'erik' => $erik, 'ux' => $ux, 'seo' => $seo, 'a' => $a, 'b' => $b, 'c' => $c, 'd' => $d, 'task' => $task, 'bug' => $bug] = $filtered();
    $items = fn (array $query): array => $ids($search($mara, ['q' => 'kontakt', 'types' => 'items', ...$query])->items);

    expect($items([]))->toBe([$a->id, $b->id, $c->id, $d->id])
        ->and($items(['type_id' => $bug]))->toBe([$b->id, $d->id])
        // a list or comma text, any case
        ->and($items(['type_id' => [Str::upper($task), $bug]]))->toBe([$a->id, $b->id, $c->id, $d->id])
        ->and($items(['type_id' => Str::upper($task).','.$bug]))->toBe([$a->id, $b->id, $c->id, $d->id])
        ->and($items(['state_category' => 'completed']))->toBe([$b->id])
        ->and($items(['state_category' => ['backlog', 'canceled']]))->toBe([$a->id, $c->id, $d->id])
        ->and($items(['assignee_id' => $mara->id]))->toBe([$a->id])
        ->and($items(['assignee_id' => [$mara->id, Str::upper($erik->id)]]))->toBe([$a->id, $d->id])
        ->and($items(['assignee_id' => 'none']))->toBe([$b->id, $c->id])
        ->and($items(['assignee_id' => ['none']]))->toBe([$b->id, $c->id])
        // an item with any of the labels
        ->and($items(['label_id' => [$ux->id, $seo->id]]))->toBe([$a->id, $b->id])
        ->and($items(['label_id' => $seo->id]))->toBe([$b->id])
        // all filters at once
        ->and($items(['type_id' => $task, 'assignee_id' => 'none', 'state_category' => 'backlog']))->toBe([$c->id])
        // a list of no values is no condition, like an empty filter of a list
        ->and($items(['type_id' => ',', 'label_id' => []]))->toBe([$a->id, $b->id, $c->id, $d->id]);

    // the engine filters before it cuts at the limit: the first bug, not the first item
    expect($items(['type_id' => $bug, 'limit' => 1]))->toBe([$b->id])
        ->and($items(['assignee_id' => 'none', 'limit' => 1]))->toBe([$b->id]);
});

it('narrows only the items', function () use ($filtered, $search, $ids) {
    searchEngine();
    ['mara' => $mara, 'web' => $web] = $filtered();
    $web->update(['name' => 'Kontakt Website']);
    app(SearchIndexer::class)->upsertProject($web->id);
    $person = User::factory()->create(['name' => 'Kontakt Lenz']);
    app(SearchIndexer::class)->upsertUser($person->id);

    $results = $search($mara, ['q' => 'kontakt', 'type_id' => (string) Str::ulid(), 'state_category' => 'started']);

    expect($ids($results->items))->toBe([])
        ->and($ids($results->projects))->toBe([$web->id])
        ->and($ids($results->people))->toBe([$person->id]);
});

it('finds nothing for an unknown value', function () use ($filtered, $search, $ids) {
    searchEngine();
    ['mara' => $mara] = $filtered();
    $unknown = (string) Str::ulid();

    foreach (['type_id', 'assignee_id', 'label_id'] as $key) {
        expect($ids($search($mara, ['q' => 'kontakt', $key => $unknown])->items))->toBe([], $key);
    }
    expect($ids($search($mara, ['q' => 'kontakt', 'state_category' => 'started'])->items))->toBe([]);
});

it('refuses a malformed filter value', function () use ($refusal) {
    $engine = searchEngine();
    $mara = User::factory()->create();
    $ulid = (string) Str::ulid();
    $errors = fn (string $categories = 'backlog, unstarted, started, completed, canceled'): array => [
        'type_id' => [__('field.type_id.invalid')],
        'state_category' => [__('field.state_category.invalid', ['allowed' => $categories])],
        'assignee_id' => [__('field.assignee_id.invalid')],
        'label_id' => [__('field.label_id.invalid')],
    ];

    // all in one answer, the other fields too
    expect($refusal($mara, ['q' => ' ', 'type_id' => 'web', 'state_category' => 'done', 'assignee_id' => 'mara', 'label_id' => 'UX']))
        ->toBe(['q' => [__('field.q.required')], ...$errors()]);

    $malformed = [
        // a quote would break the filter string of Meilisearch
        ['type_id' => $ulid.'"', 'state_category' => 'started" OR archived = true', 'assignee_id' => '"'.$ulid, 'label_id' => [$ulid, 'x"']],
        // no text in a list, and no text or list at all
        ['type_id' => [7], 'state_category' => ['started', ['completed']], 'assignee_id' => [true], 'label_id' => [$ulid, null, 3]],
        ['type_id' => 7, 'state_category' => true, 'assignee_id' => ['id' => $ulid], 'label_id' => 1.5],
        // an ULID that is one character short, a category in upper case
        ['type_id' => substr($ulid, 1), 'state_category' => 'STARTED', 'assignee_id' => 'None', 'label_id' => $ulid.'0'],
    ];
    foreach ($malformed as $query) {
        expect($refusal($mara, ['q' => 'x', ...$query]))->toBe($errors(), (string) json_encode($query));
    }

    // the engine was never asked
    expect($engine->searched())->toBe([]);
});

it('refuses none together with an account', function () use ($filtered, $refusal) {
    $engine = searchEngine();
    ['mara' => $mara] = $filtered();

    foreach ([['none', $mara->id], "{$mara->id},none"] as $assignee) {
        expect($refusal($mara, ['q' => 'kontakt', 'assignee_id' => $assignee]))->toBe(['assignee_id' => [__('field.assignee_id.invalid')]], (string) json_encode($assignee));
    }
    expect($engine->searched())->toBe([]);
});

it('puts the key match first only when it passes the filters', function () use ($filtered, $search, $ids) {
    searchEngine();
    ['mara' => $mara, 'web' => $web, 'ux' => $ux, 'seo' => $seo, 'a' => $a, 'task' => $task, 'bug' => $bug] = $filtered();
    $other = WorkItem::factory()->for($web)->create(['title' => 'Folgefehler zu web-1', 'type_id' => $bug]);
    app(SearchIndexer::class)->rebuild();
    expect($a->fresh()?->key)->toBe('WEB-1');
    $jump = fn (array $filters) => $search($mara, ['q' => 'web-1', 'types' => 'items', ...$filters]);

    // A (WEB-1) is a task of Mara in the backlog with UX
    foreach ([[], ['type_id' => $task], ['state_category' => 'backlog'], ['assignee_id' => $mara->id], ['label_id' => [$seo->id, $ux->id]]] as $passes) {
        $results = $jump($passes);
        expect($results->keyMatch)->toBe($a->id, (string) json_encode($passes))
            ->and($ids($results->items)[0])->toBe($a->id, (string) json_encode($passes));
    }

    // a filter A misses: no key match, and A is not in front; the engine leaves it out as any other item
    $misses = [
        [['type_id' => $bug], [$other->id]],
        [['state_category' => 'started'], []],
        [['assignee_id' => 'none'], [$other->id]],
        [['label_id' => $seo->id], []],
    ];
    foreach ($misses as [$filters, $found]) {
        $results = $jump($filters);
        expect($results->keyMatch)->toBeNull((string) json_encode($filters))
            ->and($ids($results->items))->toBe($found, (string) json_encode($filters));
    }
});
