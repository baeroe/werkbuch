<?php

namespace App\Console\Commands;

use App\Actions\Auth\SetPassword;
use App\Models\User;
use App\Support\PasswordRules;
use Illuminate\Console\Command;
use Illuminate\Validation\ValidationException;

/**
 * Emergency command: sets a new password for an account and ends its sessions. The password never is an argument
 * or option (shell history, process list): interactively it is asked twice without echo, otherwise the first line
 * of STDIN is used, e.g. `docker compose exec -T werkbuch php artisan app:reset-password owner@example.com < password.txt`.
 */
class ResetPasswordCommand extends Command
{
    /** Where a non-interactive run reads the password from (tests point it at a file). */
    public static string $stdin = 'php://stdin';

    protected $signature = 'app:reset-password
        {email : Email of the account}';

    protected $description = 'Set a new password for an account (asked for, or the first line of STDIN) and end its sessions';

    public function handle(SetPassword $setPassword): int
    {
        $email = (string) $this->argument('email');
        $user = User::query()->where('email', $email)->first();

        if ($user === null) {
            $this->error('There is no account with this email.');

            return self::FAILURE;
        }

        $password = $this->input->isInteractive() ? $this->askPassword() : $this->readStdin();

        if ($password === null) {
            return self::FAILURE;
        }

        try {
            $setPassword->handle($user, $password);
        } catch (ValidationException $e) {
            foreach ($e->errors() as $messages) {
                $this->error(implode(' ', $messages));
            }

            return self::FAILURE;
        }

        $this->info("New password set for {$email}; all sessions ended.");

        return self::SUCCESS;
    }

    private function askPassword(): ?string
    {
        $password = (string) $this->secret('New password (at least '.PasswordRules::MIN_LENGTH.' characters)');

        if ($password !== (string) $this->secret('Repeat the new password')) {
            $this->error('The passwords do not match.');

            return null;
        }

        return $password;
    }

    private function readStdin(): ?string
    {
        $stream = @fopen(self::$stdin, 'r');
        $line = $stream === false ? false : fgets($stream);

        if ($stream !== false) {
            fclose($stream);
        }

        $password = $line === false ? '' : rtrim($line, "\r\n");

        if ($password === '') {
            $this->error('No password on STDIN. Run the command in a terminal, or pipe the password into it.');

            return null;
        }

        return $password;
    }
}
