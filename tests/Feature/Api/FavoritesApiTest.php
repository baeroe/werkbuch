<?php

use App\Events\EventType;
use App\Models\Event;
use App\Models\Favorite;
use App\Models\Project;
use App\Models\User;

/** The shape of `Favorite` in resources/js/types.ts. */
const FAVORITE_SHAPE = ['user_id', 'kind', 'id', 'position'];

it('puts a project into the favorites and takes it out again', function () {
    $lene = User::factory()->create();
    $web = Project::factory()->identifier('WEB')->public()->create();

    $this->actingAs($lene)->postJson('/api/v1/favorites/toggle', ['kind' => 'project', 'id' => $web->id])
        ->assertOk()->assertExactJson(['kind' => 'project', 'id' => $web->id, 'favorite' => true]);

    $this->getJson('/api/v1/favorites')->assertOk()->assertJsonStructure(['data' => [FAVORITE_SHAPE], 'meta' => ['total']])
        ->assertJsonPath('data.0.user_id', $lene->id)->assertJsonPath('data.0.kind', 'project')
        ->assertJsonPath('data.0.id', $web->id)->assertJsonPath('data.0.position', 0);

    $this->postJson('/api/v1/favorites/toggle', ['kind' => 'project', 'id' => $web->id])
        ->assertOk()->assertExactJson(['kind' => 'project', 'id' => $web->id, 'favorite' => false]);
    $this->getJson('/api/v1/favorites')->assertOk()->assertJsonPath('meta.total', 0)->assertJsonPath('data', []);
});

it('numbers the positions one after the other, also after a project left', function () {
    $lene = User::factory()->create();
    [$a, $b, $c] = Project::factory()->count(3)->public()->create()->all();
    $toggle = fn (Project $project) => $this->actingAs($lene)->postJson('/api/v1/favorites/toggle', ['kind' => 'project', 'id' => $project->id])->assertOk();

    $toggle($a);
    $toggle($b);
    $toggle($c);
    expect(Favorite::query()->orderBy('position')->pluck('position', 'favoritable_id')->all())->toBe([$a->id => 0, $b->id => 1, $c->id => 2]);

    // the one in the middle leaves, a new one goes to the end: the order of the sidebar holds
    $toggle($b);
    $toggle($b);
    $this->getJson('/api/v1/favorites')->assertJsonPath('data.*.id', [$a->id, $c->id, $b->id])->assertJsonPath('data.*.position', [0, 2, 3]);
});

it('records who put a project in or took it out, without any project activity', function () {
    $lene = User::factory()->create();
    $web = Project::factory()->public()->create();

    $this->actingAs($lene)->postJson('/api/v1/favorites/toggle', ['kind' => 'project', 'id' => $web->id])->assertOk();
    $this->postJson('/api/v1/favorites/toggle', ['kind' => 'project', 'id' => $web->id])->assertOk();

    $events = Event::query()->whereIn('type', [EventType::FavoriteAdded, EventType::FavoriteRemoved])->orderBy('occurred_at')->get();

    expect($events->pluck('type')->all())->toBe([EventType::FavoriteAdded, EventType::FavoriteRemoved])
        ->and($events->pluck('actor_id')->unique()->all())->toBe([$lene->id])
        ->and($events->pluck('subject_id')->unique()->all())->toBe([$web->id])
        ->and($events->pluck('project_id')->unique()->all())->toBe([null]);
});

it('takes a project id in upper case for the project it names', function () {
    $web = Project::factory()->public()->create();

    $this->actingAs(User::factory()->create())->postJson('/api/v1/favorites/toggle', ['kind' => 'project', 'id' => strtoupper($web->id)])
        ->assertOk()->assertJsonPath('id', $web->id)->assertJsonPath('favorite', true);
});

it('refuses a kind that is no project yet', function (mixed $kind) {
    $web = Project::factory()->public()->create();

    $this->actingAs(User::factory()->create())->postJson('/api/v1/favorites/toggle', ['kind' => $kind, 'id' => $web->id])
        ->assertUnprocessable()->assertJsonPath('errors.kind.0', __('field.kind.unknown'));

    expect(Favorite::query()->count())->toBe(0);
})->with(['view' => 'view', 'unknown' => 'page', 'not named' => null, 'not a text' => [['project']]]);

it('refuses an id that is not named or no text', function (mixed $id) {
    $this->actingAs(User::factory()->create())->postJson('/api/v1/favorites/toggle', ['kind' => 'project', 'id' => $id])
        ->assertUnprocessable()->assertJsonPath('errors.id.0', __('field.id.invalid'));
})->with(['not named' => null, 'not a text' => [['x']]]);

it('does not find a project that does not exist or that the account does not see', function () {
    $ops = Project::factory()->identifier('OPS')->private()->create();

    $this->actingAs(User::factory()->create())->postJson('/api/v1/favorites/toggle', ['kind' => 'project', 'id' => $ops->id])
        ->assertNotFound()->assertJsonMissingPath('detail');
    $this->postJson('/api/v1/favorites/toggle', ['kind' => 'project', 'id' => '01jzzzzzzzzzzzzzzzzzzzzzzz'])->assertNotFound();
    $this->postJson('/api/v1/favorites/toggle', ['kind' => 'project', 'id' => 'OPS'])->assertNotFound();

    expect(Favorite::query()->count())->toBe(0);
});

it('lists only the own favorites', function () {
    $lene = User::factory()->create();
    $mara = User::factory()->create();
    [$a, $b] = Project::factory()->count(2)->public()->create()->all();

    $this->actingAs($lene)->postJson('/api/v1/favorites/toggle', ['kind' => 'project', 'id' => $a->id])->assertOk();
    $this->actingAs($mara)->postJson('/api/v1/favorites/toggle', ['kind' => 'project', 'id' => $b->id])->assertOk();

    $this->getJson('/api/v1/favorites')->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.user_id', $mara->id)->assertJsonPath('data.0.id', $b->id);
    $this->actingAs($lene)->getJson('/api/v1/favorites')->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.id', $a->id);

    // one account switching a project does not touch the other's
    $this->postJson('/api/v1/favorites/toggle', ['kind' => 'project', 'id' => $b->id])->assertOk()->assertJsonPath('favorite', true);
    expect(Favorite::query()->where('favoritable_id', $b->id)->count())->toBe(2);
});

it('pages through the favorites', function () {
    $lene = User::factory()->create();
    $this->actingAs($lene);

    foreach (Project::factory()->count(3)->public()->create() as $project) {
        $this->postJson('/api/v1/favorites/toggle', ['kind' => 'project', 'id' => $project->id])->assertOk();
    }

    $first = $this->getJson('/api/v1/favorites?per_page=2')->assertOk()->assertJsonCount(2, 'data')->assertJsonPath('meta.total', 3);
    $this->getJson('/api/v1/favorites?per_page=2&cursor='.$first->json('meta.next_cursor'))->assertOk()
        ->assertJsonCount(1, 'data')->assertJsonPath('data.0.position', 2);
});

it('drops a project that is deleted or hidden from the list at once', function () {
    $admin = User::factory()->admin()->create();
    $ops = Project::factory()->identifier('OPS')->private()->create();

    $this->actingAs($admin)->postJson('/api/v1/favorites/toggle', ['kind' => 'project', 'id' => $ops->id])->assertOk();
    $this->getJson('/api/v1/favorites')->assertJsonPath('meta.total', 1);

    $this->deleteJson('/api/v1/projects/OPS')->assertStatus(202);
    $this->getJson('/api/v1/favorites')->assertJsonPath('meta.total', 0);
});
