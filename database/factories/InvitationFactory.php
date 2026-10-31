<?php

namespace Database\Factories;

use App\Access\OrgRole;
use App\Models\Invitation;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Invitation>
 */
class InvitationFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'email' => fake()->unique()->userName().'@example.com',
            'org_role' => OrgRole::Member,
            'projects' => [],
            'invited_by' => User::factory()->admin(),
            'expires_at' => now()->addDays(Invitation::VALID_DAYS),
        ];
    }

    public function expired(): static
    {
        return $this->state(fn (array $attributes) => ['expires_at' => now()->subSecond()]);
    }

    public function accepted(): static
    {
        return $this->state(fn (array $attributes) => ['accepted_at' => now()]);
    }
}
