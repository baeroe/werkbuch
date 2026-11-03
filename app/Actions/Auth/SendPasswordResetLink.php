<?php

namespace App\Actions\Auth;

use Illuminate\Support\Facades\Password;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Sends the reset link through the password broker, as a job on the queue `notifications`. The broker writes the token
 * and calls User::sendPasswordResetNotification(), which mails only active people; for unknown addresses and a link
 * that went out moments ago (throttle) nothing happens. The job runs once: a second run would write a new token and
 * make the link of the mail useless. The mail is a job of its own with its own retries (ResetPasswordNotification), so
 * a mail server that fails only sends the same link again.
 */
final class SendPasswordResetLink
{
    use AsAction;

    public string $jobQueue = 'notifications';

    public int $jobTries = 1;

    public function handle(string $email): void
    {
        Password::broker(config('fortify.passwords'))->sendResetLink(['email' => $email]);
    }
}
