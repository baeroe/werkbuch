<?php

use App\Access\OrgRole;
use App\Access\Visibility;
use App\Actions\Auth\EnsureAdmin;
use App\Console\Commands\EnsureAdminCommand;
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
    $events = Event::query()->where('subject_type', $user->getMorphClass())->where('subject_id', $user->id)->get();

    expect($events)->toHaveCount(1)
        ->and(eventsOf(EventType::UserCreated, $user))->toHaveCount(1)
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

    $this->artisan('app:ensure-admin')->expectsOutputToContain('Already set up')->assertSuccessful();

    expect(User::query()->where('is_default_bot', false)->count())->toBe(1);
});

it('is not stopped by bots, which cannot sign in', function () {
    User::factory()->bot()->create();

    $this->artisan('app:ensure-admin')->expectsOutputToContain('created')->assertSuccessful();

    expect(User::query()->where('is_default_bot', false)->count())->toBe(2);
});

it('warns without failing when the values are missing and nobody can sign in', function (?string $email, ?string $password) {
    config(['werkbuch.admin.email' => $email, 'werkbuch.admin.password' => $password]);

    $this->artisan('app:ensure-admin')->expectsOutputToContain('are not set')->assertSuccessful();

    expect(User::query()->where('is_default_bot', false)->count())->toBe(0);
})->with([
    'nothing set' => [null, null],
    'no password' => ['owner@example.com', null],
    'no email' => [null, 'secret-pass'],
    'empty strings' => ['', ''],
]);

it('says it is set up when people exist, whatever the values', function (?string $email, ?string $password) {
    User::factory()->create(['email' => 'mara@example.com']);
    config(['werkbuch.admin.email' => $email, 'werkbuch.admin.password' => $password]);

    $this->artisan('app:ensure-admin')
        ->expectsOutputToContain('Already set up: ADMIN_EMAIL and ADMIN_PASSWORD are only used on the first start.')
        ->assertSuccessful();

    expect(User::query()->where('is_default_bot', false)->count())->toBe(1);
})->with([
    'nothing set (ADMIN_PASSWORD removed after the first sign-in)' => [null, null],
    'empty strings' => ['', ''],
    'no password' => ['owner@example.com', null],
    'the placeholder of the standalone file' => ['owner@example.com', EnsureAdmin::PLACEHOLDER],
]);

it('tells the existing admin that the values are only read on the first start', function () {
    $this->artisan('app:ensure-admin')->assertSuccessful();
    config(['werkbuch.admin.password' => null]);

    $this->artisan('app:ensure-admin')
        ->expectsOutputToContain('owner@example.com already exists; nothing changed. ADMIN_EMAIL and ADMIN_PASSWORD are only used on the first start.')
        ->assertSuccessful();
});

it('exits with NO_ACCOUNT under --require-account only while no person exists', function (bool $person) {
    config(['werkbuch.admin.email' => 'owner@example.com', 'werkbuch.admin.password' => null]);
    $person && User::factory()->create();

    $this->artisan('app:ensure-admin', ['--require-account' => true])->assertExitCode($person ? 0 : EnsureAdminCommand::NO_ACCOUNT);
    // without the option the missing values stay a warning
    $this->artisan('app:ensure-admin')->assertSuccessful();
})->with([
    'no person' => [false],
    'a person exists' => [true],
]);

it('keeps NO_ACCOUNT apart from the failure of invalid values', function () {
    config(['werkbuch.admin.password' => 'short']);

    $this->artisan('app:ensure-admin', ['--require-account' => true])->assertExitCode(1);

    // docker/entrypoint.d/99-werkbuch.sh compares with this number (ImageTest runs the script with it)
    expect(EnsureAdminCommand::NO_ACCOUNT)->toBe(3);
});

it('fails and creates nothing for invalid values', function (string $email, string $password, string $message) {
    config(['werkbuch.admin.email' => $email, 'werkbuch.admin.password' => $password]);

    $this->artisan('app:ensure-admin')->expectsOutputToContain($message)->assertFailed();

    expect(User::query()->where('is_default_bot', false)->count())->toBe(0);
})->with([
    'invalid email' => ['not-an-email', 'secret-pass', 'email'],
    'short password' => ['owner@example.com', 'short', 'at least 8'],
    'placeholder password' => ['owner@example.com', 'change-me', 'placeholder'],
]);

it('names the placeholder with the sentence of lang', function () {
    config(['werkbuch.admin.password' => EnsureAdmin::PLACEHOLDER]);

    $this->artisan('app:ensure-admin')->expectsOutputToContain(__('field.admin_password.placeholder'))->assertFailed();

    expect(User::query()->where('is_default_bot', false)->count())->toBe(0);
});

it('does not mind the placeholder once accounts exist', function () {
    User::factory()->create();
    config(['werkbuch.admin.password' => EnsureAdmin::PLACEHOLDER]);

    $this->artisan('app:ensure-admin')->assertSuccessful();

    expect(User::query()->where('is_default_bot', false)->count())->toBe(1);
});
