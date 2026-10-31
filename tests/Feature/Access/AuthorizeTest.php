<?php

use App\Access\Authorize;
use App\Exceptions\Problem;
use App\Models\User;
use Illuminate\Auth\Access\Response;
use Illuminate\Support\Facades\Gate;

beforeEach(function () {
    $this->user = User::factory()->create();
});

/**
 * The problem Authorize::check throws for an ability.
 */
function refusal(User $user, string $ability): Problem
{
    try {
        Authorize::check(actor($user), $ability);
    } catch (Problem $problem) {
        return $problem;
    }

    throw new RuntimeException("[{$ability}] was allowed.");
}

it('returns when the policy allows, with the arguments passed on', function () {
    Gate::define('test.allowed', fn (User $user, string $first, string $second) => $user->is($this->user) && $first === 'one' && $second === 'two');

    Authorize::check(actor($this->user), 'test.allowed', 'one', 'two');

    expect(fn () => Authorize::check(actor($this->user), 'test.allowed', 'one', 'three'))->toThrow(Problem::class);
});

it('refuses with the sentence of the policy', function () {
    Gate::define('test.denied', fn () => Response::deny('Nur Admins.'));

    $problem = refusal($this->user, 'test.denied');

    expect($problem->status)->toBe(403)->and($problem->reason)->toBe('forbidden')->and($problem->detail)->toBe('Nur Admins.');
});

it('refuses without a sentence when the policy gives none', function () {
    Gate::define('test.false', fn () => false);

    $problem = refusal($this->user, 'test.false');

    expect($problem->status)->toBe(403)->and($problem->detail)->toBeNull();
});

it('hides what the account must not see as not found, without a detail', function () {
    Gate::define('test.hidden', fn () => Response::denyAsNotFound('Geheim.'));

    $problem = refusal($this->user, 'test.hidden');

    expect($problem->status)->toBe(404)->and($problem->reason)->toBe('not_found')->and($problem->detail)->toBeNull();
});
