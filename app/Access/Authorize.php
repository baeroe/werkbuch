<?php

namespace App\Access;

use App\Exceptions\Problem;
use App\Support\Actor;
use Illuminate\Support\Facades\Gate;

/**
 * How actions check a policy (P5): a refusal becomes a Problem. `Response::denyAsNotFound()` is a 404 without a
 * detail, so nothing leaks about what the account must not see; any other refusal is a 403 with the sentence of
 * the policy. A run token asks RunTokenGuard first: what it must not do is a 403 `agent_forbidden` before any policy,
 * the same for what it sees and what not.
 */
final class Authorize
{
    public static function check(Actor $actor, string $ability, mixed ...$arguments): void
    {
        if (! RunTokenGuard::permits($actor, $ability, $arguments)) {
            RunTokenGuard::refuse($actor);
        }

        $response = Gate::forUser($actor->user)->inspect($ability, $arguments);

        if ($response->allowed()) {
            return;
        }

        if ($response->status() === 404) {
            throw Problem::notFound();
        }

        throw Problem::forbidden($response->message());
    }

    /** Whether the policy lets the actor do it, for an action that picks among several things it may act through. */
    public static function allows(Actor $actor, string $ability, mixed ...$arguments): bool
    {
        return RunTokenGuard::permits($actor, $ability, $arguments) && Gate::forUser($actor->user)->inspect($ability, $arguments)->allowed();
    }
}
