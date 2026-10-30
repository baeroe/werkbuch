<?php

use App\Http\Middleware\EnsureAccountIsActive;
use App\Http\Middleware\EnsureTokenAbility;
use App\Models\User;
use Illuminate\Support\Facades\Route;

beforeEach(function () {
    Route::middleware(['api', 'auth:sanctum', EnsureAccountIsActive::class, EnsureTokenAbility::class])->prefix('api/v1')->group(function () {
        Route::get('_t/thing', fn () => ['read' => true]);
        Route::post('_t/thing', fn () => ['written' => true]);
    });
});

it('lets a token that may read only read', function () {
    $token = apiToken(User::factory()->create(), ['read']);

    $this->withToken($token)->getJson('/api/v1/_t/thing')->assertOk();
    $this->withToken($token)->postJson('/api/v1/_t/thing')->assertForbidden()
        ->assertHeader('Content-Type', 'application/problem+json')->assertJsonPath('reason', 'forbidden')
        ->assertJsonPath('detail', __('problem.detail.token_ability', ['ability' => 'write']));
});

it('lets a token that may write only write', function () {
    $token = apiToken(User::factory()->create(), ['write']);

    $this->withToken($token)->postJson('/api/v1/_t/thing')->assertOk();
    $this->withToken($token)->getJson('/api/v1/_t/thing')->assertForbidden()
        ->assertJsonPath('detail', __('problem.detail.token_ability', ['ability' => 'read']));
});

it('lets the session do both', function () {
    $this->actingAs(User::factory()->create());

    $this->getJson('/api/v1/_t/thing')->assertOk();
    $this->postJson('/api/v1/_t/thing')->assertOk();
});

it('lets a token with both abilities do both, and a token for MCP neither', function () {
    $user = User::factory()->create();
    $both = apiToken($user, ['read', 'write']);
    $mcp = apiToken($user, ['mcp']);

    $this->withToken($both)->getJson('/api/v1/_t/thing')->assertOk();
    $this->withToken($both)->postJson('/api/v1/_t/thing')->assertOk();
    forgetApiAuth();
    $this->withToken($mcp)->getJson('/api/v1/_t/thing')->assertForbidden();
    $this->withToken($mcp)->postJson('/api/v1/_t/thing')->assertForbidden();
});
