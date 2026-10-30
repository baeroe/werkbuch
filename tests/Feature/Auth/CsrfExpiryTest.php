<?php

use App\Enums\Locale;
use App\Models\User;
use Illuminate\Session\TokenMismatchException;
use Illuminate\Support\Facades\Route;
use Inertia\Testing\AssertableInertia as Assert;

// CSRF is not checked in unit tests, so the test routes throw the exception themselves; Laravel turns it into an
// HttpException(419) before the render callbacks, exactly as in production.
beforeEach(function () {
    Route::middleware('web')->post('_t/expired', fn () => throw new TokenMismatchException);
    Route::middleware('api')->prefix('api/v1')->post('_t/expired', fn () => throw new TokenMismatchException);
});

it('leads an expired session back to the sign-in with a readable message', function () {
    $this->from('/login')->post('_t/expired')->assertRedirect('/login');

    expect(session('error'))->toBe(__('errors.page_expired'));
    $this->get('/login')->assertInertia(fn (Assert $p) => $p->component('Auth/Login')->where('flash.error', __('errors.page_expired')));
});

it('leads a guest to the sign-in even from a page that needs an account', function () {
    $this->from('/my-items')->withHeader('X-Inertia', 'true')->post('_t/expired')->assertRedirect('/login');

    expect(session('error'))->toBe(__('errors.page_expired'));
});

it('names the expiry in the language of the visitor', function () {
    $this->from('/login')->withUnencryptedCookie('locale', Locale::De->value)->post('_t/expired')->assertRedirect('/login');

    expect(session('error'))->toBe(trans('errors.page_expired', [], 'de'))->not->toBe(trans('errors.page_expired', [], 'en'));
});

it('keeps a signed-in person on the page and names the expiry in the language of the account', function () {
    $this->actingAs(User::factory()->locale(Locale::De)->create())
        ->from('/settings')->post('_t/expired')->assertRedirect('/settings');

    expect(session('error'))->toBe(trans('errors.page_expired', [], 'de'));
});

it('answers the API with problem details', function () {
    $this->postJson('api/v1/_t/expired')->assertStatus(419)
        ->assertHeader('Content-Type', 'application/problem+json')
        ->assertJsonPath('reason', 'csrf_token_mismatch');
});

it('answers other HTTP errors of the browser app as before', function () {
    Route::middleware('web')->post('_t/forbidden', fn () => abort(403));

    $this->from('/login')->post('_t/forbidden')->assertForbidden();
});
