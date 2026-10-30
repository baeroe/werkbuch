<?php

namespace App\Actions\Accounts;

use App\Domain\Accounts\Handle;
use App\Models\User;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The one place that finds a free handle for a new account (P24): the stem of a name or an email address, numbered on
 * until no account holds it. It only reads; the unique index on `users.handle` stays the last word.
 */
final class NextHandle
{
    use AsAction;

    public function handle(string $seed): string
    {
        return Handle::suggest($seed, fn (string $h): bool => User::query()->where('handle', $h)->exists());
    }
}
