<?php

namespace App\Actions\Auth;

use Illuminate\Support\Facades\Password;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Sends the reset link through the password broker, as a job on the queue `notifications`. The broker writes the token
 * and calls User::sendPasswordResetNotification(), which mails only active people; for unknown addresses and a link
 * that went out moments ago (throttle) nothing happens.
 */
final class SendPasswordResetLink
{
    use AsAction;

    public string $jobQueue = 'notifications';

    public function handle(string $email): void
    {
        Password::broker(config('fortify.passwords'))->sendResetLink(['email' => $email]);
    }
}
