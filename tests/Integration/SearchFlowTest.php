<?php

use App\Access\ProjectRole;
use App\Domain\Workflow\StateCategory;
use App\Models\Project;
use App\Models\User;
use App\Models\Workflow;
use App\Search\SearchConsumer;
use Illuminate\Support\Facades\Artisan;
use Tests\Support\Meili;

beforeEach(function () {
    Meili::use();
    consumers(SearchConsumer::class);
    Artisan::call('app:search-sync');
    Meili::settle();
});

it('finds an item created over REST, and no longer once it is archived or deleted', function () {
    $mara = User::factory()->create();
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Admin)->create();
    $done = Workflow::default()->states->firstOrFail(fn ($state) => $state->category === StateCategory::Completed);
    $token = apiToken($mara, ['read', 'write']);
    $hits = function (string $query) use ($token): array {
        forgetApiAuth();

        return $this->withToken($token)->getJson('/api/v1/search?types=items&q='.$query)->assertOk()->json('data.items.*.id');
    };

    $id = $this->withToken($token)->postJson('/api/v1/work-items', [
        'project_id' => $web->id, 'title' => 'Kontaktformular Pflichtfelder', 'state_id' => $done->id,
    ])->assertCreated()->json('data.id');
    Meili::settle();

    expect($hits('kontaktformular'))->toBe([$id]);

    forgetApiAuth();
    $this->withToken($token)->postJson("/api/v1/work-items/{$id}/archive")->assertOk();
    Meili::settle();

    expect($hits('kontaktformular'))->toBe([])
        ->and($hits('kontaktformular&include_archived=1'))->toBe([$id]);

    forgetApiAuth();
    $this->withToken($token)->deleteJson("/api/v1/work-items/{$id}")->assertNoContent();
    Meili::settle();

    expect($hits('kontaktformular&include_archived=1'))->toBe([])
        ->and(Meili::ids('testing_work_items', 'kontaktformular'))->toBe([]);
});

it('finds a page created over REST by its text, its saved title, and no longer once it is deleted', function () {
    $mara = User::factory()->create();
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Admin)->create();
    $token = apiToken($mara, ['read', 'write']);
    $hits = function (string $query) use ($token): array {
        forgetApiAuth();

        return $this->withToken($token)->getJson('/api/v1/search?types=pages&q='.$query)->assertOk()->json('data.pages.*.id');
    };

    $id = $this->withToken($token)->postJson("/api/v1/projects/{$web->id}/pages", [
        'title' => 'Onboarding', 'content' => 'Der **Ablauf** am ersten Tag',
    ])->assertCreated()->json('data.id');
    Meili::settle();

    expect($hits('ablauf'))->toBe([$id])
        ->and($hits('onboarding'))->toBe([$id]);

    forgetApiAuth();
    $this->withToken($token)->patchJson("/api/v1/pages/{$id}", ['title' => 'Einarbeitung'])->assertOk();
    Meili::settle();

    expect($hits('einarbeitung'))->toBe([$id])
        ->and($hits('onboarding'))->toBe([]);

    forgetApiAuth();
    $this->withToken($token)->deleteJson("/api/v1/pages/{$id}")->assertOk();
    Meili::settle();

    expect($hits('ablauf'))->toBe([])
        ->and(Meili::ids('testing_pages', 'ablauf'))->toBe([]);
});

it('finds items while the pages index is empty', function () {
    $mara = User::factory()->create();
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Admin)->create();
    $token = apiToken($mara, ['read', 'write']);
    $id = $this->withToken($token)->postJson('/api/v1/work-items', ['project_id' => $web->id, 'title' => 'Kontaktformular'])
        ->assertCreated()->json('data.id');
    Meili::settle();

    // app:search-sync made the index (beforeEach): searching it answers nothing, never index_not_found (K14)
    forgetApiAuth();
    $response = $this->withToken($token)->getJson('/api/v1/search?q=kontaktformular')->assertOk();

    expect($response->json('data.items.*.id'))->toBe([$id])
        ->and($response->json('data.pages'))->toBe([]);
});
