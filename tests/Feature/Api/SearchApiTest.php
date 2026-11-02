<?php

use App\Access\ProjectRole;
use App\Enums\Locale;
use App\Models\Project;
use App\Models\User;
use App\Models\View;
use App\Models\WorkItem;
use App\Search\SearchIndexer;
use Illuminate\Support\Facades\Exceptions;
use Meilisearch\Exceptions\CommunicationException;

/** Mara (German), member of WEB „Website“ with WEB-1 „Kontaktformular prüfen“ and a view „Kontakt offen“, all indexed. */
$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara Kontakt', 'locale' => Locale::De]);
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Member)->create(['name' => 'Kontakt Website']);
    $item = WorkItem::factory()->for($web)->create(['title' => 'Kontaktformular prüfen', 'description_text' => 'Pflichtfelder']);
    $view = View::factory()->create(['name' => 'Kontakt offen', 'created_by' => $mara->id]);
    app(SearchIndexer::class)->rebuild();

    return [$mara, $web, $item, $view];
};

it('searches with a read token', function () use ($world) {
    searchEngine();
    [$mara, $web, $item, $view] = $world();

    $response = $this->withToken(apiToken($mara, ['read']))->getJson('/api/v1/search?q=kontakt&types=items,projects,people,views')->assertOk();

    expect(array_keys($response->json()))->toBe(['data'])
        ->and(array_keys($response->json('data')))->toBe(['items', 'projects', 'people', 'views', 'key_match'])
        ->and($response->json('data.items.*.id'))->toBe([$item->id])
        ->and($response->json('data.items.0'))->toHaveKeys(['key', 'title', 'values'])->not->toHaveKeys(['description', 'description_json', 'values_markdown'])
        ->and($response->json('data.projects.*.id'))->toBe([$web->id])
        ->and($response->json('data.projects.0'))->toHaveKeys(['identifier', 'my_role', 'is_member'])
        ->and($response->json('data.people.*.id'))->toBe([$mara->id])
        ->and($response->json('data.views.*.id'))->toBe([$view->id])
        ->and($response->json('data.key_match'))->toBeNull();

    forgetApiAuth();
    $key = $this->withToken(apiToken($mara, ['read']))->getJson('/api/v1/search?q=web-1&types[]=items')->assertOk();

    expect($key->json('data.key_match'))->toBe($item->id)
        ->and($key->json('data.items.*.key'))->toBe(['WEB-1'])
        ->and($key->json('data.projects'))->toBe([])
        ->and($key->json('data.people'))->toBe([])
        ->and($key->json('data.views'))->toBe([]);
});

it('answers 422 in the language of the account', function () use ($world) {
    searchEngine();
    [$mara] = $world();

    $response = $this->withToken(apiToken($mara, ['read']))->getJson('/api/v1/search?q=%20&limit=99')->assertUnprocessable();

    expect(errorsAt($response, 'q'))->toBe([trans('field.q.required', [], 'de')])
        ->and(errorsAt($response, 'limit'))->toBe([trans('field.limit.invalid', ['max' => 50], 'de')])
        ->and(trans('field.q.required', [], 'de'))->toBe('Gib einen Suchbegriff ein.');
});

it('answers 503 as problem details', function () use ($world) {
    Exceptions::fake();
    $engine = searchEngine();
    [$mara] = $world();
    $engine->failWith(new CommunicationException('down'));

    $response = $this->withToken(apiToken($mara, ['read']))->getJson('/api/v1/search?q=kontakt')->assertStatus(503);

    expect($response->headers->get('Content-Type'))->toBe('application/problem+json')
        ->and($response->json())->toMatchArray([
            'type' => 'urn:werkbuch:problem:search_unavailable',
            'status' => 503,
            'detail' => trans('problem.reason.search_unavailable', [], 'de'),
            'reason' => 'search_unavailable',
        ])
        ->and($response->getContent())->not->toContain('down');
    // once, the cause: the 503 itself is no second entry in the log
    Exceptions::assertReported(CommunicationException::class);
    Exceptions::assertReportedCount(1);
});
