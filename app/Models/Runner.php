<?php

namespace App\Models;

use App\Domain\Agents\AgentCli;
use App\Domain\Agents\Places;
use App\Domain\Agents\Protocol;
use App\Domain\Agents\RunStatus;
use Carbon\CarbonImmutable;
use Database\Factories\RunnerFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

/**
 * A runner (spec 5, 6, 8.4): a machine of the organization with the daemon `werkbuch-runner`, paired with a one-time
 * code. It authenticates with a token of its own (A472), only its hash is stored. Its places are set in werkbuch, its
 * load, CLIs and equipment are the last report it sent (spec 8.6–8.8). A revoked runner keeps its row: its runs name it.
 *
 * @property string $id
 * @property string $name
 * @property string $token_hash
 * @property string $os
 * @property string $arch
 * @property string $version
 * @property int $protocol
 * @property int $slots_total
 * @property int $slots_per_repo
 * @property int $slots_light
 * @property array<string, mixed>|null $load
 * @property list<array<string, mixed>> $clis
 * @property array<string, mixed>|null $equipment
 * @property CarbonImmutable|null $last_seen_at
 * @property CarbonImmutable|null $revoked_at
 * @property string $created_by
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read User $creator
 * @property-read Collection<int, AgentRun> $busyRuns
 */
#[Fillable(['name', 'token_hash', 'os', 'arch', 'version', 'protocol', 'slots_total', 'slots_per_repo', 'slots_light', 'load', 'clis', 'equipment', 'last_seen_at', 'revoked_at', 'created_by'])]
#[Hidden(['token_hash'])]
final class Runner extends Model
{
    /** @use HasFactory<RunnerFactory> */
    use HasFactory, HasUlids;

    /** The prefix of a runner token: it is no personal access token (`wb_`). */
    public const TOKEN_PREFIX = 'wbr_';

    /** The places of a new runner (spec 9). */
    public const DEFAULT_SLOTS = ['total' => 2, 'per_repo' => 1, 'light' => 2];

    /** The most places one pot takes. */
    public const MAX_SLOTS = 16;

    public const NAME_MAX = 64;

    /** A runner counts as online this long after its last contact (it polls every 3 to 10 seconds, spec 6.1). */
    public const ONLINE_SECONDS = 60;

    protected function casts(): array
    {
        return [
            'protocol' => 'integer',
            'slots_total' => 'integer',
            'slots_per_repo' => 'integer',
            'slots_light' => 'integer',
            'load' => 'array',
            'clis' => 'array',
            'equipment' => 'array',
            'last_seen_at' => 'immutable_datetime',
            'revoked_at' => 'immutable_datetime',
        ];
    }

    /** A new token: the prefix and 48 random characters; the caller stores only its hash. */
    public static function newToken(): string
    {
        return self::TOKEN_PREFIX.Str::random(48);
    }

    public static function hashToken(string $token): string
    {
        return hash('sha256', $token);
    }

    /** The active runner of a token, or null (unknown, revoked, not a runner token). */
    public static function findByToken(?string $token): ?self
    {
        if ($token === null || ! str_starts_with($token, self::TOKEN_PREFIX)) {
            return null;
        }

        return self::query()->where('token_hash', self::hashToken($token))->whereNull('revoked_at')->first();
    }

    /** @return BelongsTo<User, $this> */
    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    /** @return HasMany<AgentRun, $this> */
    public function runs(): HasMany
    {
        return $this->hasMany(AgentRun::class);
    }

    /**
     * The runs that hold a place on it now (running or being canceled).
     *
     * @return HasMany<AgentRun, $this>
     */
    public function busyRuns(): HasMany
    {
        return $this->hasMany(AgentRun::class)->whereIn('status', [RunStatus::Running->value, RunStatus::Canceling->value]);
    }

    public function places(): Places
    {
        return new Places($this->slots_total, $this->slots_per_repo, $this->slots_light);
    }

    public function isOnline(): bool
    {
        return $this->revoked_at === null && $this->last_seen_at !== null && $this->last_seen_at->isAfter(now()->subSeconds(self::ONLINE_SECONDS));
    }

    /** Whether another runner may take over a strand of this one: revoked, or offline for the fixed grace (spec 9). */
    public function isGone(): bool
    {
        return $this->revoked_at !== null || $this->last_seen_at === null || $this->last_seen_at->isBefore(now()->subMinutes(Protocol::TAKEOVER_MINUTES));
    }

    /** Whether the last report names the CLI installed and signed in (spec 8.8). */
    public function hasCli(AgentCli $cli): bool
    {
        foreach ($this->clis as $entry) {
            if (($entry['cli'] ?? null) === $cli->value && ($entry['installed'] ?? false) === true && ($entry['logged_in'] ?? false) === true) {
                return true;
            }
        }

        return false;
    }
}
