<?php

use App\Models\User;
use Illuminate\Support\Facades\Route;
use Inertia\Testing\AssertableInertia as Assert;

beforeEach(function () {
    Route::middleware('web')->get('_t/forbidden', fn () => abort(403));
    Route::middleware('web')->get('_t/broken', fn () => throw new LogicException('Broken on purpose.'));
    Route::middleware('web')->get('_t/unavailable', fn () => abort(503));
    Route::middleware('web')->get('_t/teapot', fn () => abort(418));
    Route::get('_t/bare-unavailable', fn () => abort(503));
});

it('shows a refusal as the error page with its status', function () {
    $this->actingAs(User::factory()->create())->get('_t/forbidden')->assertForbidden()
        ->assertInertia(fn (Assert $page) => $page->component('Errors/Error')->where('status', 403));
});

it('shows an outage as the error page with its status', function () {
    $this->get('_t/unavailable')->assertStatus(503)
        ->assertInertia(fn (Assert $page) => $page->component('Errors/Error')->where('status', 503));
});

it('shows a failure as the error page when debug is off', function () {
    config(['app.debug' => false]);

    $this->get('_t/broken')->assertStatus(500)
        ->assertInertia(fn (Assert $page) => $page->component('Errors/Error')->where('status', 500));
});

it('keeps the debug page of Laravel for a failure when debug is on', function () {
    config(['app.debug' => true]);

    $this->get('_t/broken')->assertStatus(500)->assertSee('Broken on purpose.')->assertDontSee('<script data-page="app"', false);
});

it('leaves every other status to Laravel', function () {
    $this->get('_t/teapot')->assertStatus(418)->assertDontSee('<script data-page="app"', false);
});

it('leaves an answer without the shared props of the web group to Laravel', function () {
    $this->get('_t/bare-unavailable')->assertStatus(503)->assertDontSee('<script data-page="app"', false);
});

it('keeps the problem documents of /api', function () {
    $this->getJson('api/v1/nothing-here')->assertNotFound()->assertHeader('Content-Type', 'application/problem+json');
});
