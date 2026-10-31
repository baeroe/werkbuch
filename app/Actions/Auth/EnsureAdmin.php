<?php

namespace App\Actions\Auth;

use App\Access\OrgRole;
use App\Access\RoleAssignments;
use App\Actions\Accounts\NextHandle;
use App\Enums\AccountType;
use App\Enums\EnsureAdminOutcome;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Models\User;
use App\Support\Actor;
use App\Support\PasswordRules;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Creates the first account from ADMIN_EMAIL and ADMIN_PASSWORD, and only while no person exists yet (bots, the
 * default bot among them, do not count). Decides in this order: values missing, account (this one or another) present,
 * else create: an org admin with the checked password, noted as `user.created` by the system (A4, P25).
 */
final class EnsureAdmin
{
    use AsAction;

    private const PLACEHOLDER_PASSWORD = 'change-me';

    public function __construct(private readonly RoleAssignments $roles) {}

    /**
     * @throws ValidationException for an invalid email or password; nothing is created then
     */
    public function handle(?string $email, #[\SensitiveParameter] ?string $password): EnsureAdminOutcome
    {
        if (blank($email) || blank($password)) {
            return EnsureAdminOutcome::NotConfigured;
        }

        $email = Str::lower(trim($email));

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
                'handle' => NextHandle::run($name),
                'email' => $email,
                'password' => $password,
            ]);

            $this->roles->setOrgRole($user, OrgRole::Admin);
            EventRecorder::record(EventType::UserCreated, Actor::system($user, 'ensure_admin'), $user, null);
        });

        return EnsureAdminOutcome::Created;
    }

    private function validate(string $email, string $password): void
    {
        Validator::make(
            ['email' => $email, 'password' => $password],
            ['email' => ['email', 'max:255'], 'password' => PasswordRules::rules()],
        )->validate();

        if ($password === self::PLACEHOLDER_PASSWORD) {
            throw ValidationException::withMessages(['password' => 'ADMIN_PASSWORD still is the placeholder "'.self::PLACEHOLDER_PASSWORD.'"; set a real password.']);
        }
    }
}
