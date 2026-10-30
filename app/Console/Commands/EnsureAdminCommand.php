<?php

namespace App\Console\Commands;

use App\Actions\Auth\EnsureAdmin;
use App\Enums\EnsureAdminOutcome;
use Illuminate\Console\Command;
use Illuminate\Validation\ValidationException;

/**
 * Creates the first account from ADMIN_EMAIL and ADMIN_PASSWORD. Asks nothing, decides nothing: EnsureAdmin does, this prints the outcome.
 */
class EnsureAdminCommand extends Command
{
    protected $signature = 'app:ensure-admin';

    protected $description = 'Create the first account from ADMIN_EMAIL and ADMIN_PASSWORD when no account exists yet';

    public function handle(EnsureAdmin $ensureAdmin): int
    {
        $email = config('werkbuch.admin.email');
        $password = config('werkbuch.admin.password');
        $email = is_string($email) ? $email : null;

        try {
            $outcome = $ensureAdmin->handle($email, is_string($password) ? $password : null);
        } catch (ValidationException $e) {
            foreach ($e->errors() as $messages) {
                $this->error(implode(' ', $messages));
            }

            return self::FAILURE;
        }

        match ($outcome) {
            EnsureAdminOutcome::Created => $this->info("Admin account {$email} created."),
            EnsureAdminOutcome::Exists => $this->info("{$email} already exists; nothing changed. Remove ADMIN_PASSWORD from .env."),
            EnsureAdminOutcome::AccountsExist => $this->info('Accounts exist already; ADMIN_EMAIL is only used on the first start.'),
            EnsureAdminOutcome::NotConfigured => $this->warn('ADMIN_EMAIL/ADMIN_PASSWORD are not set; no account created. Without any account nobody can sign in.'),
        };

        return self::SUCCESS;
    }
}
