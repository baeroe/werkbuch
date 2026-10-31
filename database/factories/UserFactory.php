<?php

namespace Database\Factories;

use App\Access\OrgRole;
use App\Access\RoleAssignments;
use App\Enums\AccountType;
use App\Enums\Locale;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/**
 * @extends Factory<User>
 */
class UserFactory extends Factory
{
    /**
     * The current password being used by the factory.
     */
    protected static ?string $password;

    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $handle = 'user-'.fake()->unique()->lexify('??????');

        return [
            'type' => AccountType::Person,
            'name' => fake()->name(),
            'handle' => $handle,
            'is_default_bot' => false,
            'email' => $handle.'@example.com',
            'password' => static::$password ??= Hash::make('password'),
            'locale' => null,
            'timezone' => null,
            'remember_token' => Str::random(10),
        ];
    }

    /**
     * Every account gets its role in the organization: member, unless a state says admin.
     */
    public function configure(): static
    {
        return $this->afterCreating(fn (User $user) => app(RoleAssignments::class)->setOrgRole($user, OrgRole::Member));
    }

    /**
     * An org admin.
     */
    public function admin(): static
    {
        return $this->afterCreating(fn (User $user) => app(RoleAssignments::class)->setOrgRole($user, OrgRole::Admin));
    }

    /**
     * A bot account: no email, no password.
     */
    public function bot(?User $owner = null): static
    {
        return $this->state(fn (array $attributes) => [
            'type' => AccountType::Bot,
            'email' => null,
            'password' => null,
            'owner_id' => $owner?->id,
        ]);
    }

    /**
     * A disabled account.
     */
    public function disabled(): static
    {
        return $this->state(fn (array $attributes) => [
            'disabled_at' => now(),
        ]);
    }

    /**
     * An account with a fixed interface language.
     */
    public function locale(Locale $locale): static
    {
        return $this->state(fn (array $attributes) => [
            'locale' => $locale,
        ]);
    }
}
