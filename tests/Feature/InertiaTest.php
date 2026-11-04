<?php

use App\Enums\Locale;
use App\Models\Organization;
use App\Models\User;
use App\Support\MailSetup;
use Illuminate\Support\Facades\Route;
use Inertia\Testing\AssertableInertia as Assert;

it('renders unknown paths as the Inertia 404 page', function () {
    $this->actingAs(User::factory()->create())->get('/does-not-exist')->assertNotFound()
        ->assertInertia(fn (Assert $page) => $page->component('Errors/NotFound'));
});

it('shares the page context with guests', function () {
    $this->get(inertiaProbe())->assertInertia(fn (Assert $page) => $page
        ->where('auth.user', null)->where('auth.permissions', [])
        ->where('organization', ['id' => Organization::current()->id, 'name' => 'werkbuch', 'locale' => 'en', 'timezone' => 'UTC', 'week_start' => 1, 'logo_url' => null])
        ->where('features', ['mail' => false, 'live' => null, 'attachments_max_mb' => 25])
        ->where('flash', ['status' => null, 'error' => null]));
});

it('shares the live settings when Reverb is the broadcaster', function () {
    config([
        'broadcasting.default' => 'reverb',
        'broadcasting.connections.reverb.key' => 'live-key',
        'broadcasting.connections.reverb.options' => ['host' => 'live.example.com', 'port' => '6001', 'scheme' => 'https'],
    ]);

    $this->get(inertiaProbe())->assertInertia(fn (Assert $page) => $page
        ->where('features.live', ['key' => 'live-key', 'host' => 'live.example.com', 'port' => 6001, 'scheme' => 'https']));
});

it('shares no live settings for the log broadcaster', function () {
    config(['broadcasting.default' => 'log']);

    $this->get(inertiaProbe())->assertInertia(fn (Assert $page) => $page->where('features.live', null));
});

it('shares no live settings while the key or the host of Reverb is missing (T2-M3)', function (array $missing) {
    config([
        'broadcasting.default' => 'reverb',
        'broadcasting.connections.reverb.key' => 'live-key',
        'broadcasting.connections.reverb.options' => ['host' => 'live.example.com', 'port' => '6001', 'scheme' => 'https'],
        ...$missing,
    ]);

    $this->get(inertiaProbe())->assertInertia(fn (Assert $page) => $page->where('features.live', null));
})->with([
    'no key' => [['broadcasting.connections.reverb.key' => null]],
    'an empty key' => [['broadcasting.connections.reverb.key' => '']],
    'no host' => [['broadcasting.connections.reverb.options.host' => null]],
]);

it('shares exactly the fields of the signed-in account', function () {
    $user = User::factory()->locale(Locale::De)->create();
    $this->actingAs($user)->get(inertiaProbe())->assertInertia(fn (Assert $page) => $page
        ->where('auth.user', ['id' => $user->id, 'type' => 'person', 'name' => $user->name, 'handle' => $user->handle,
            'email' => $user->email, 'org_role' => 'member', 'is_default_bot' => false, 'owner_id' => null, 'disabled_at' => null,
            'avatar_url' => null, 'locale' => 'de', 'timezone' => 'UTC']));
});

it('shares the role and the rights of the account in the organization', function () {
    $this->actingAs(User::factory()->admin()->create())->get(inertiaProbe())->assertInertia(fn (Assert $page) => $page
        ->where('auth.user.org_role', 'admin')
        ->where('auth.permissions', fn ($permissions) => collect($permissions)->contains('org.manage') && collect($permissions)->contains('project.see_all')));

    $this->actingAs(User::factory()->create())->get(inertiaProbe())->assertInertia(fn (Assert $page) => $page
        ->where('auth.user.org_role', 'member')
        ->where('auth.permissions', ['project.join', 'project.create', 'view.create', 'token.own']));
});

it('shares the organization from its record', function () {
    Organization::current()->update(['name' => 'Feldwerk', 'locale' => Locale::De, 'timezone' => 'Europe/Berlin', 'week_start' => 0]);

    $this->get(inertiaProbe())->assertInertia(fn (Assert $page) => $page
        ->where('organization.name', 'Feldwerk')->where('organization.locale', 'de')
        ->where('organization.timezone', 'Europe/Berlin')->where('organization.week_start', 0));
});

it('shares the props on a 404 from a route binding', function () {
    Route::middleware(['web', 'auth'])->get('_t/bound/{user}', fn (User $user) => 'x');

    $this->actingAs(User::factory()->create())->get('_t/bound/01JZZZZZZZZZZZZZZZZZZZZZZZ')->assertNotFound()
        ->assertInertia(fn (Assert $page) => $page->component('Errors/NotFound')->where('locale', 'en'));
});

it('shares the flash messages of the session once', function () {
    $this->withSession(['status' => 'Saved.', 'error' => 'Nope.'])->get(inertiaProbe())
        ->assertInertia(fn (Assert $page) => $page->where('flash', ['status' => 'Saved.', 'error' => 'Nope.']));
});

it('reports mail as configured unless the mailer only logs', function (string $mailer, bool $configured) {
    config(['mail.default' => $mailer]);
    expect(MailSetup::configured())->toBe($configured);
})->with([['smtp', true], ['log', false], ['array', false]]);
