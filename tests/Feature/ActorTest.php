<?php

use App\Models\User;
use App\Support\Actor;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

beforeEach(function () {
    Route::middleware('auth:sanctum')->get('_t/actor', function (Request $request) {
        $actor = Actor::fromRequest($request);

        return ['user' => $actor->user->id, 'via' => $actor->via, 'token' => $actor->token?->id, 'meta' => $actor->meta()];
    });
});

it('acts in the interface for a signed-in session, without a token', function () {
    $user = User::factory()->create();

    $this->actingAs($user)->getJson('/_t/actor')
        ->assertExactJson(['user' => $user->id, 'via' => 'ui', 'token' => null, 'meta' => ['via' => 'ui', 'reason' => null]]);
});

it('acts through the api with the bearer token', function () {
    $user = User::factory()->create();
    $token = $user->createToken('ci');

    $this->withToken($token->plainTextToken)->getJson('/_t/actor')->assertExactJson([
        'user' => $user->id,
        'via' => 'api',
        'token' => $token->accessToken->id,
        'meta' => ['via' => 'api', 'reason' => null, 'token_id' => $token->accessToken->id],
    ]);
});

it('needs an account', function () {
    Actor::fromRequest(Request::create('/'));
})->throws(AuthenticationException::class);

it('lets automations act as the default bot', function () {
    $bot = User::query()->where('handle', 'automation')->sole();

    $actor = Actor::automation('Automatisierung: Auto-Archiv');

    expect($actor->user->is($bot))->toBeTrue()
        ->and($actor->via)->toBe(Actor::VIA_AUTOMATION)
        ->and($actor->reason)->toBe('Automatisierung: Auto-Archiv')
        ->and($actor->token)->toBeNull();
});

it('acts for the system on behalf of an account', function () {
    $user = User::factory()->create();

    $actor = Actor::system($user, 'ensure_admin');

    expect($actor->user->is($user))->toBeTrue()
        ->and($actor->via)->toBe(Actor::VIA_SYSTEM)
        ->and($actor->reason)->toBe('ensure_admin')
        ->and($actor->meta())->toBe(['via' => 'system', 'reason' => 'ensure_admin']);
});

it('names every way an action can be started', function () {
    expect([Actor::VIA_UI, Actor::VIA_API, Actor::VIA_MCP, Actor::VIA_AUTOMATION, Actor::VIA_TEMPLATE, Actor::VIA_SYSTEM])
        ->toBe(['ui', 'api', 'mcp', 'automation', 'template', 'system']);
});
