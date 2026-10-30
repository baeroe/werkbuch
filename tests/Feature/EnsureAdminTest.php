<?php

use App\Access\OrgRole;
use App\Access\Visibility;
use App\Enums\AccountType;
use App\Events\EventType;
use App\Models\Event;
use App\Models\User;
use Illuminate\Support\Facades\Hash;

beforeEach(fn () => config(['werkbuch.admin.email' => 'owner@example.com', 'werkbuch.admin.password' => 'secret-pass']));

// the default bot of the migration is always there: the tests count and read the other accounts

it('creates the first person from ADMIN_EMAIL and ADMIN_PASSWORD', function () {
    $this->artisan('app:ensure-admin')->expectsOutputToContain('Admin account owner@example.com created.')->assertSuccessful();

    $user = User::query()->where('is_default_bot', false)->sole();
    expect([$user->email, $user->handle, $user->name, $user->type])->toBe(['owner@example.com', 'owner', 'owner', AccountType::Person])
        ->and(Hash::check('secret-pass', (string) $user->password))->toBeTrue()
        ->and(Visibility::orgRole($user))->toBe(OrgRole::Admin);
});

it('notes exactly one event, user.created by the system', function () {
    $this->artisan('app:ensure-admin')->assertSuccessful();

    $user = User::query()->where('is_default_bot', false)->sole();
    $events = Event::query()->where('subject_id', $user->id)->get();

    expect($events)->toHaveCount(1)
        ->and($events[0]->type)->toBe(EventType::UserCreated)
        ->and($events[0]->actor_id)->toBe($user->id)
        ->and($events[0]->meta)->toBe(['via' => 'system', 'reason' => 'ensure_admin']);
});

it('stores the email trimmed and in lower case', function () {
    config(['werkbuch.admin.email' => ' Owner@Example.com ']);

    $this->artisan('app:ensure-admin')->assertSuccessful();
    $this->artisan('app:ensure-admin')->expectsOutputToContain('already exists; nothing changed')->assertSuccessful();

    expect(User::query()->where('is_default_bot', false)->sole()->email)->toBe('owner@example.com');
});

it('takes a free handle when the one derived from the email is taken', function () {
    User::factory()->bot()->create(['handle' => 'owner']);

    $this->artisan('app:ensure-admin')->assertSuccessful();

    expect(User::query()->where('email', 'owner@example.com')->sole()->handle)->toBe('owner-2');
});

it('changes nothing on the next start', function () {
    $this->artisan('app:ensure-admin')->assertSuccessful();
    User::query()->where('is_default_bot', false)->sole()->update(['password' => 'changed-in-the-ui']);

    $this->artisan('app:ensure-admin')->expectsOutputToContain('already exists; nothing changed')->assertSuccessful();

    expect(User::query()->where('is_default_bot', false)->count())->toBe(1)->and(Hash::check('changed-in-the-ui', (string) User::query()->where('is_default_bot', false)->sole()->password))->toBeTrue();
});

it('creates no second admin once people exist', function () {
    User::factory()->create(['email' => 'mara@example.com']);

    $this->artisan('app:ensure-admin')->expectsOutputToContain('only used on the first start')->assertSuccessful();

    expect(User::query()->where('is_default_bot', false)->count())->toBe(1);
});

it('is not stopped by bots, which cannot sign in', function () {
    User::factory()->bot()->create();

    $this->artisan('app:ensure-admin')->expectsOutputToContain('created')->assertSuccessful();

    expect(User::query()->where('is_default_bot', false)->count())->toBe(2);
});

it('warns without failing when the values are missing', function (?string $email, ?string $password, bool $person) {
    config(['werkbuch.admin.email' => $email, 'werkbuch.admin.password' => $password]);
    $person && User::factory()->create();

    $this->artisan('app:ensure-admin')->expectsOutputToContain('are not set')->assertSuccessful();

    expect(User::query()->where('is_default_bot', false)->count())->toBe($person ? 1 : 0);
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

    expect(User::query()->where('is_default_bot', false)->count())->toBe(0);
})->with([
    'invalid email' => ['not-an-email', 'secret-pass', 'email'],
    'short password' => ['owner@example.com', 'short', 'at least 8'],
    'placeholder password' => ['owner@example.com', 'change-me', 'placeholder'],
]);
