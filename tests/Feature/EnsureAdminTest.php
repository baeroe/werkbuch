<?php

use App\Enums\AccountType;
use App\Models\User;
use Illuminate\Support\Facades\Hash;

beforeEach(fn () => config(['werkbuch.admin.email' => 'owner@example.com', 'werkbuch.admin.password' => 'secret-pass']));

it('creates the first person from ADMIN_EMAIL and ADMIN_PASSWORD', function () {
    $this->artisan('app:ensure-admin')->expectsOutputToContain('Admin account owner@example.com created.')->assertSuccessful();

    $user = User::sole();
    expect([$user->email, $user->handle, $user->name, $user->type])->toBe(['owner@example.com', 'owner', 'owner', AccountType::Person])
        ->and(Hash::check('secret-pass', (string) $user->password))->toBeTrue();
});

it('takes a free handle when the one derived from the email is taken', function () {
    User::factory()->bot()->create(['handle' => 'owner']);

    $this->artisan('app:ensure-admin')->assertSuccessful();

    expect(User::query()->where('email', 'owner@example.com')->sole()->handle)->toBe('owner-2');
});

it('changes nothing on the next start', function () {
    $this->artisan('app:ensure-admin')->assertSuccessful();
    User::sole()->update(['password' => 'changed-in-the-ui']);

    $this->artisan('app:ensure-admin')->expectsOutputToContain('already exists; nothing changed')->assertSuccessful();

    expect(User::count())->toBe(1)->and(Hash::check('changed-in-the-ui', (string) User::sole()->password))->toBeTrue();
});

it('creates no second admin once people exist', function () {
    User::factory()->create(['email' => 'mara@example.com']);

    $this->artisan('app:ensure-admin')->expectsOutputToContain('only used on the first start')->assertSuccessful();

    expect(User::count())->toBe(1);
});

it('is not stopped by bots, which cannot sign in', function () {
    User::factory()->bot()->create();

    $this->artisan('app:ensure-admin')->expectsOutputToContain('created')->assertSuccessful();

    expect(User::count())->toBe(2);
});

it('warns without failing when the values are missing', function (?string $email, ?string $password, bool $person) {
    config(['werkbuch.admin.email' => $email, 'werkbuch.admin.password' => $password]);
    $person && User::factory()->create();

    $this->artisan('app:ensure-admin')->expectsOutputToContain('are not set')->assertSuccessful();

    expect(User::count())->toBe($person ? 1 : 0);
})->with([
    'nothing set' => [null, null, false],
    'no password' => ['owner@example.com', null, false],
    'no email' => [null, 'secret-pass', false],
    'empty strings' => ['', '', false],
    'nothing set, a person exists' => [null, null, true],
]);

it('fails and creates nothing for invalid values', function (string $email, string $password, string $message) {
    config(['werkbuch.admin.email' => $email, 'werkbuch.admin.password' => $password]);

    $this->artisan('app:ensure-admin')->expectsOutputToContain($message)->assertFailed();

    expect(User::count())->toBe(0);
})->with([
    'invalid email' => ['not-an-email', 'secret-pass', 'email'],
    'short password' => ['owner@example.com', 'short', 'at least 8'],
    'placeholder password' => ['owner@example.com', 'change-me', 'placeholder'],
]);
