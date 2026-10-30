<?php

namespace App\Actions\Auth;

use App\Domain\Accounts\Handle;
use App\Enums\AccountType;
use App\Enums\EnsureAdminOutcome;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Creates the first account from ADMIN_EMAIL and ADMIN_PASSWORD, and only while nobody exists yet. Decides in this
 * order: values missing, account (this one or another) present, else create. Phase 2 adds the admin role of the organization.
 */
final class EnsureAdmin
{
    use AsAction;

    private const PLACEHOLDER_PASSWORD = 'change-me';

    public function __construct(private readonly SetPassword $setPassword) {}

    /**
     * @throws ValidationException for an invalid email or password; nothing is created then
     */
    public function handle(?string $email, ?string $password): EnsureAdminOutcome
    {
        if (blank($email) || blank($password)) {
            return EnsureAdminOutcome::NotConfigured;
        }

        if (User::query()->where('email', $email)->exists()) {
            return EnsureAdminOutcome::Exists;
        }

        if (User::query()->where('type', AccountType::Person)->exists()) {
            return EnsureAdminOutcome::AccountsExist;
        }

        $this->validate($email, $password);
        $name = (string) strstr($email, '@', true);

        DB::transaction(function () use ($email, $password, $name): void {
            $user = User::query()->create([
                'type' => AccountType::Person,
                'name' => $name,
                'handle' => Handle::suggest($name, fn (string $handle): bool => User::query()->where('handle', $handle)->exists()),
                'email' => $email,
            ]);

            $this->setPassword->handle($user, $password);
        });

        return EnsureAdminOutcome::Created;
    }

    private function validate(string $email, string $password): void
    {
        Validator::make(['email' => $email], ['email' => ['email', 'max:255']])->validate();

        if ($password === self::PLACEHOLDER_PASSWORD) {
            throw ValidationException::withMessages(['password' => 'ADMIN_PASSWORD still is the placeholder "'.self::PLACEHOLDER_PASSWORD.'"; set a real password.']);
        }
    }
}
