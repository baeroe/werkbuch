<?php

namespace App\Actions\Auth;

use Illuminate\Support\Str;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Takes a request for a reset link and answers at once: the lookup of the account, the token and the mail happen in a
 * queued job (SendPasswordResetLink). So the request takes the same time and does the same work for every address,
 * and a mail server that is down only fails the job.
 */
final class RequestPasswordReset
{
    use AsAction;

    public function handle(string $email): void
    {
        SendPasswordResetLink::dispatch(Str::lower($email));
    }
}
