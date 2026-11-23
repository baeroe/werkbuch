<?php

namespace Database\Factories;

use App\Domain\Agents\Protocol;
use App\Models\Runner;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * An online runner on a Mac with Claude Code installed and signed in, the default places, created by a new org admin;
 * its token is unknown (`withToken` sets one). No events.
 *
 * @extends Factory<Runner>
 */
class RunnerFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'name' => 'mac-'.fake()->unique()->numberBetween(1, 999_999),
            'token_hash' => Runner::hashToken(Runner::newToken()),
            'os' => 'darwin',
            'arch' => 'arm64',
            'version' => (string) config('werkbuch.version'),
            'protocol' => Protocol::VERSION,
            'slots_total' => Runner::DEFAULT_SLOTS['total'],
            'slots_per_repo' => Runner::DEFAULT_SLOTS['per_repo'],
            'slots_light' => Runner::DEFAULT_SLOTS['light'],
            'load' => null,
            'clis' => [['cli' => 'claude', 'installed' => true, 'version' => '2.4.1', 'logged_in' => true, 'path' => '/usr/local/bin/claude']],
            'equipment' => null,
            'last_seen_at' => now(),
            'revoked_at' => null,
            'created_by' => User::factory()->admin(),
        ];
    }

    /** A runner whose token is the one given. */
    public function withToken(string $token): static
    {
        return $this->state(['token_hash' => Runner::hashToken($token)]);
    }

    /** These places. */
    public function slots(int $total, int $perRepo, int $light): static
    {
        return $this->state(['slots_total' => $total, 'slots_per_repo' => $perRepo, 'slots_light' => $light]);
    }

    /** A runner whose machine reports these CLIs (`cli` → signed in). */
    public function clis(array $clis): static
    {
        return $this->state(['clis' => array_map(fn (string $cli, bool $in) => ['cli' => $cli, 'installed' => true, 'version' => '1.0.0', 'logged_in' => $in, 'path' => "/usr/local/bin/{$cli}"], array_keys($clis), $clis)]);
    }

    /** Last seen this many minutes ago. */
    public function offlineFor(int $minutes): static
    {
        return $this->state(fn () => ['last_seen_at' => now()->subMinutes($minutes)]);
    }
}
