<?php

use App\Enums\AccountType;
use App\Enums\Locale;
use App\Models\User;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

it('stores people with a ULID, a hashed password and typed columns', function () {
    $user = User::factory()->locale(Locale::De)->create(['password' => 'secret-pass']);

    expect(Str::isUlid($user->id))->toBeTrue()
        ->and($user->type)->toBe(AccountType::Person)
        ->and($user->locale)->toBe(Locale::De)
        ->and(Hash::check('secret-pass', (string) $user->password))->toBeTrue()
        ->and($user->isPerson())->toBeTrue()
        ->and($user->isDisabled())->toBeFalse();
});

it('knows bots and disabled accounts', function () {
    expect(User::factory()->bot()->create()->isPerson())->toBeFalse()
        ->and(User::factory()->bot()->create()->email)->toBeNull()
        ->and(User::factory()->disabled()->create()->isDisabled())->toBeTrue();
});

it('lists the supported languages', fn () => expect(Locale::values())->toBe(['en', 'de']));

it('refuses a second account with the same handle or email', function () {
    User::factory()->create(['handle' => 'mara', 'email' => 'mara@example.com']);

    expect(fn () => User::factory()->create(['handle' => 'mara']))->toThrow(UniqueConstraintViolationException::class)
        ->and(fn () => User::factory()->create(['email' => 'mara@example.com']))->toThrow(UniqueConstraintViolationException::class);
});
