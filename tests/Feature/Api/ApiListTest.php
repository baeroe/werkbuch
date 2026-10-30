<?php

use App\Http\Api\ApiList;
use App\Http\Resources\UserResource;
use App\Models\User;
use App\Support\ListResult;
use App\Support\PageArgs;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Illuminate\Validation\ValidationException;

beforeEach(function () {
    Route::middleware('api')->prefix('api/v1')->get('_t/people', fn (Request $request) => ApiList::respond(
        ListResult::of(User::query()->where('is_default_bot', false)->orderBy('id'), PageArgs::from($request->query())),
        UserResource::class,
    ));
});

it('pages with a cursor and counts every match', function () {
    $people = User::factory()->count(3)->create()->sortBy('id')->values();

    $first = $this->getJson('/api/v1/_t/people?per_page=2')->assertOk()
        ->assertJsonPath('meta.total', 3)->assertJsonPath('meta.per_page', 2)->assertJsonPath('meta.prev_cursor', null)
        ->assertJsonPath('meta.path', url('/api/v1/_t/people'))
        ->assertJsonPath('data.0.id', $people[0]->id)->assertJsonPath('data.1.id', $people[1]->id)
        ->assertJsonStructure(['data', 'links' => ['first', 'last', 'prev', 'next'], 'meta' => ['path', 'per_page', 'next_cursor', 'prev_cursor', 'total']]);
    $cursor = $first->json('meta.next_cursor');
    expect($cursor)->toBeString()->not->toBe('');

    $this->getJson('/api/v1/_t/people?per_page=2&cursor='.$cursor)->assertOk()
        ->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $people[2]->id)
        ->assertJsonPath('meta.total', 3)->assertJsonPath('meta.next_cursor', null);
});

it('shows up to 100 per page unless asked for fewer', function () {
    expect(PageArgs::from([]))->toEqual(new PageArgs(null, 100))
        ->and(PageArgs::from(['per_page' => '7', 'cursor' => 'abc']))->toEqual(new PageArgs('abc', 7));
});

it('refuses a page size outside 1 to 100 at per_page', function (mixed $perPage) {
    $this->getJson('/api/v1/_t/people?per_page='.$perPage)->assertUnprocessable()
        ->assertJsonPath('reason', 'validation_failed')->assertJsonValidationErrors(['per_page']);
})->with([0, 101, 'many']);

it('refuses a cursor that is not text', function () {
    expect(fn () => PageArgs::from(['cursor' => ['x']]))->toThrow(ValidationException::class);
});

it('shows people and bots in the shape of User, the description only with bots', function () {
    $owner = User::factory()->admin()->create();
    $bot = User::factory()->bot($owner)->create(['description' => 'Writes release notes.']);
    User::factory()->bot()->create(['description' => null]);

    $response = $this->getJson('/api/v1/_t/people')->assertOk()->assertJsonPath('meta.total', 3);
    $byId = collect($response->json('data'))->keyBy('id');

    expect($byId[$owner->id])->toBe([
        'id' => $owner->id, 'type' => 'person', 'name' => $owner->name, 'handle' => $owner->handle, 'email' => $owner->email,
        'org_role' => 'admin', 'is_default_bot' => false, 'owner_id' => null, 'disabled_at' => null, 'avatar_url' => null,
        'locale' => 'en', 'timezone' => 'UTC',
    ])->and($byId[$bot->id])->toMatchArray(['type' => 'bot', 'email' => null, 'org_role' => 'member', 'owner_id' => $owner->id, 'description' => 'Writes release notes.'])
        ->and(collect($byId)->firstWhere('description', ''))->not->toBeNull();
});

it('shows when an account was disabled', function () {
    $this->freezeSecond();
    User::factory()->disabled()->create();

    $this->getJson('/api/v1/_t/people')->assertJsonPath('data.0.disabled_at', now()->toJSON());
});
