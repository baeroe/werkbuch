<?php

namespace App\Access;

use App\Exceptions\Problem;
use App\Support\Actor;
use Illuminate\Support\Facades\Gate;

/**
 * How actions check a policy (P5): a refusal becomes a Problem. `Response::denyAsNotFound()` is a 404 without a
 * detail, so nothing leaks about what the account must not see; any other refusal is a 403 with the sentence of
 * the policy.
 */
final class Authorize
{
    public static function check(Actor $actor, string $ability, mixed ...$arguments): void
    {
        $response = Gate::forUser($actor->user)->inspect($ability, $arguments);

        if ($response->allowed()) {
            return;
        }

        if ($response->status() === 404) {
            throw Problem::notFound();
        }

        throw Problem::forbidden($response->message());
    }
}
