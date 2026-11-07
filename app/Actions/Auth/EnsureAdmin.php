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
 * default bot among them, do not count). Decides in this order: a person present (this email or another; the values
 * do not matter then, they are read on the first start only), values missing, else create: an org admin with the
 * checked password, noted as `user.created` by the system (A4, P25).
 */
final class EnsureAdmin
{
    use AsAction;

    public const PLACEHOLDER = 'change-me';

    public function __construct(private readonly RoleAssignments $roles) {}

    /**
     * @throws ValidationException for an invalid email or password; nothing is created then
     */
    public function handle(?string $email, #[\SensitiveParameter] ?string $password): EnsureAdminOutcome
    {
        $email = blank($email) ? null : Str::lower(trim($email));

        if (User::query()->where('type', AccountType::Person)->exists()) {
            return $email !== null && User::query()->where('email', $email)->exists()
                ? EnsureAdminOutcome::Exists
                : EnsureAdminOutcome::AccountsExist;
        }

        if ($email === null || blank($password)) {
            return EnsureAdminOutcome::NotConfigured;
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

        if ($password === self::PLACEHOLDER) {
            throw ValidationException::withMessages(['password' => __('field.admin_password.placeholder')]);
        }
    }
}
