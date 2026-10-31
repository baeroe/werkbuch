<?php

use App\Enums\Locale;
use App\Models\Event;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Database\Eloquent\ModelNotFoundException;

it('has the default bot of the migration, and none without it', function () {
    $migrated = User::defaultBot();
    Event::query()->delete(); // accounts with history stay (they are disabled, never deleted)
    $migrated->delete();

    expect($migrated->handle)->toBe('automation')
        ->and(fn () => User::defaultBot())->toThrow(ModelNotFoundException::class);

    $bot = User::factory()->bot()->create(['is_default_bot' => true]);

    expect(User::defaultBot()->is($bot))->toBeTrue()
        ->and($bot->is_default_bot)->toBeTrue()
        ->and($bot->isBot())->toBeTrue()
        ->and(User::factory()->create()->is_default_bot)->toBeFalse();
});

it('knows who owns a bot and keeps the bot when the owner goes', function () {
    $owner = User::factory()->create();
    $bot = User::factory()->bot($owner)->create();

    expect($bot->owner?->is($owner))->toBeTrue()
        ->and(User::factory()->bot()->create()->owner)->toBeNull()
        ->and($owner->isBot())->toBeFalse();

    $owner->delete();

    expect($bot->fresh()?->owner_id)->toBeNull();
});

it('takes its own language and time zone, else those of the organization', function () {
    Organization::current()->update(['locale' => Locale::De, 'timezone' => 'Europe/Berlin']);

    $own = User::factory()->locale(Locale::En)->create(['timezone' => 'Asia/Tokyo']);
    $inherited = User::factory()->create();

    expect($own->effectiveLocale())->toBe(Locale::En)
        ->and($own->effectiveTimezone())->toBe('Asia/Tokyo')
        ->and($inherited->effectiveLocale())->toBe(Locale::De)
        ->and($inherited->effectiveTimezone())->toBe('Europe/Berlin');
});

it('keeps the two-factor columns out of the array form', function () {
    $user = User::factory()->create([
        'two_factor_secret' => 'secret',
        'two_factor_recovery_codes' => 'codes',
        'two_factor_confirmed_at' => now(),
    ]);

    expect($user->toArray())->not->toHaveKeys(['two_factor_secret', 'two_factor_recovery_codes', 'password'])
        ->and($user->two_factor_confirmed_at)->not->toBeNull()
        ->and($user->fresh()?->two_factor_secret)->toBe('secret');
});

it('keeps a description on an account', function () {
    expect(User::factory()->bot()->create(['description' => 'Imports tickets'])->description)->toBe('Imports tickets');
});
