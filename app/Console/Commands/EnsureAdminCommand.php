<?php

namespace App\Console\Commands;

use App\Actions\Auth\EnsureAdmin;
use App\Enums\EnsureAdminOutcome;
use Illuminate\Console\Command;
use Illuminate\Validation\ValidationException;

/**
 * Creates the first account from ADMIN_EMAIL and ADMIN_PASSWORD. Asks nothing, decides nothing: EnsureAdmin does, this prints the outcome.
 * With --require-account, a start without any person and without the values ends with NO_ACCOUNT: the entrypoint of
 * the image reads that code, never the words (they may change).
 */
class EnsureAdminCommand extends Command
{
    /** Exit code under --require-account: nobody can sign in, and ADMIN_EMAIL/ADMIN_PASSWORD are missing. */
    public const NO_ACCOUNT = 3;

    protected $signature = 'app:ensure-admin {--require-account : Exit with 3 when no person exists and none was created}';

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
            EnsureAdminOutcome::Exists => $this->info("{$email} already exists; nothing changed. ADMIN_EMAIL and ADMIN_PASSWORD are only used on the first start."),
            EnsureAdminOutcome::AccountsExist => $this->info('Already set up: ADMIN_EMAIL and ADMIN_PASSWORD are only used on the first start.'),
            EnsureAdminOutcome::NotConfigured => $this->warn('ADMIN_EMAIL/ADMIN_PASSWORD are not set; no account created. Without any account nobody can sign in.'),
        };

        return $outcome === EnsureAdminOutcome::NotConfigured && $this->option('require-account') ? self::NO_ACCOUNT : self::SUCCESS;
    }
}
