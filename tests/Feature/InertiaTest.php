<?php

use App\Enums\Locale;
use App\Models\User;
use App\Support\MailSetup;
use Inertia\Testing\AssertableInertia as Assert;

it('renders unknown paths as the Inertia 404 page', function () {
    $this->actingAs(User::factory()->create())->get('/does-not-exist')->assertNotFound()
        ->assertInertia(fn (Assert $page) => $page->component('Errors/NotFound'));
});

it('shares the page context with guests', function () {
    $this->get(inertiaProbe())->assertInertia(fn (Assert $page) => $page
        ->where('auth.user', null)->where('auth.permissions', [])
        ->where('organization', ['name' => 'werkbuch', 'locale' => 'en', 'timezone' => config('app.timezone'), 'week_start' => 1, 'logo_url' => null])
        ->where('features', ['mail' => false, 'live' => null])
        ->where('flash', ['status' => null, 'error' => null]));
});

it('shares exactly the fields of the signed-in account', function () {
    $user = User::factory()->locale(Locale::De)->create();
    $this->actingAs($user)->get(inertiaProbe())->assertInertia(fn (Assert $page) => $page
        ->where('auth.user', ['id' => $user->id, 'type' => 'person', 'name' => $user->name, 'handle' => $user->handle,
            'email' => $user->email, 'locale' => 'de', 'timezone' => null, 'avatar_url' => null]));
});

it('shares the flash messages of the session once', function () {
    $this->withSession(['status' => 'Saved.', 'error' => 'Nope.'])->get(inertiaProbe())
        ->assertInertia(fn (Assert $page) => $page->where('flash', ['status' => 'Saved.', 'error' => 'Nope.']));
});

it('reports mail as configured unless the mailer only logs', function (string $mailer, bool $configured) {
    config(['mail.default' => $mailer]);
    expect(MailSetup::configured())->toBe($configured);
})->with([['smtp', true], ['log', false], ['array', false]]);
