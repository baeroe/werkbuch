<?php

use App\Models\User;
use Database\Seeders\DatabaseSeeder;
use Database\Seeders\DemoSeeder;
use Database\Seeders\E2eSeeder;
use Illuminate\Support\Facades\Hash;

it('seeds the six demo people of the clickdummy', function () {
    $this->seed(DemoSeeder::class);
    expect(User::orderBy('handle')->pluck('email', 'handle')->all())->toBe([
        'ida' => 'ida@feldwerk.example.com', 'jonas' => 'jonas@feldwerk.example.com', 'lene' => 'lene@feldwerk.example.com',
        'mara' => 'mara@feldwerk.example.com', 'sven' => 'sven@feldwerk.example.com', 'theo' => 'theo@feldwerk.example.com',
    ])->and(User::where('handle', 'sven')->sole()->isDisabled())->toBeTrue()
        ->and(User::where('locale', 'de')->where('timezone', 'Europe/Berlin')->count())->toBe(6);
});

it('disables only Sven, at 17:00 Berlin time on 18 September 2026', function () {
    $this->seed(DemoSeeder::class);
    expect(User::whereNotNull('disabled_at')->pluck('handle')->all())->toBe(['sven'])
        ->and(User::where('handle', 'sven')->sole()->disabled_at->utc()->format('Y-m-d H:i'))->toBe('2026-09-18 15:00');
});

it('runs again without duplicates and resets the demo password', function () {
    $this->seed(DemoSeeder::class);
    User::where('handle', 'lene')->sole()->update(['password' => 'changed-elsewhere']);
    $this->seed(DemoSeeder::class);
    expect(User::count())->toBe(6)->and(Hash::check(DemoSeeder::PASSWORD, User::where('handle', 'lene')->sole()->password))->toBeTrue();
});

it('adds the e2e people on top', function () {
    $this->seed(E2eSeeder::class);
    $this->seed(E2eSeeder::class);
    $reset = User::where('email', 'reset-phone-dark@example.com')->sole();
    expect(User::count())->toBe(11)->and(User::where('email', 'e2e@example.com')->sole()->locale)->toBeNull()
        ->and($reset->handle)->toBe('reset-phone-dark')->and($reset->name)->toBe('Rita Reset')
        ->and(Hash::check('e2e-password', $reset->password))->toBeTrue();
});

it('seeds the demo data through the database seeder, except in production', function () {
    $this->seed(DatabaseSeeder::class);
    expect(User::count())->toBe(6);
    User::query()->delete();

    $this->app['env'] = 'production';
    (new DatabaseSeeder)->run();
    expect(User::count())->toBe(0);
});

it('refuses production', function () {
    $this->app['env'] = 'production';
    // Called directly: db:seed itself asks for a confirmation in production.
    expect(fn () => (new DemoSeeder)->run())->toThrow(RuntimeException::class)
        ->and(fn () => (new E2eSeeder)->run())->toThrow(RuntimeException::class)
        ->and(User::count())->toBe(0);
});
