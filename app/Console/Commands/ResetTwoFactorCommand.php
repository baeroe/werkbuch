<?php

namespace App\Console\Commands;

use App\Actions\Auth\ResetTwoFactor;
use App\Models\User;
use Illuminate\Console\Command;

/**
 * Emergency command: turns the second factor of an account off when its authenticator app and recovery codes are lost,
 * and ends its sessions. The person then signs in with the password alone and can set it up again.
 */
class ResetTwoFactorCommand extends Command
{
    protected $signature = 'app:reset-two-factor
        {email : Email of the account}';

    protected $description = 'Turn off the two-factor sign-in of an account (lost authenticator app and recovery codes) and end its sessions';

    public function handle(ResetTwoFactor $reset): int
    {
        $email = (string) $this->argument('email');
        $user = User::query()->where('email', $email)->first();

        if ($user === null) {
            $this->error('There is no account with this email.');

            return self::FAILURE;
        }

        if (! $reset->handle($user)) {
            $this->info("Two-factor sign-in is off already for {$email}; nothing changed.");

            return self::SUCCESS;
        }

        $this->info("Two-factor sign-in turned off for {$email}; all sessions ended.");

        return self::SUCCESS;
    }
}
