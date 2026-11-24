<?php

namespace App\Models;

use App\Access\Visibility;
use App\Domain\Agents\AgentCli;
use App\Domain\Agents\Protocol;
use App\Domain\Agents\RunStatus;
use App\Domain\Agents\RunType;
use Carbon\CarbonImmutable;
use Database\Factories\AgentRunFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * A run of an agent (spec 5, 7.5): its kind, status (with a reason while it waits), the bot, CLI and model (and where the
 * model came from), the runner it runs on, its project (always), item (mostly) and strand, its attempt and lease while it
 * runs, and what came of it. The ULID is its age: the order of the queue after kind and priority (spec 9).
 *
 * @property string $id
 * @property RunType $type
 * @property RunStatus $status
 * @property string|null $waiting_reason
 * @property string $bot_id
 * @property AgentCli $cli
 * @property string $model
 * @property string $model_source
 * @property string|null $model_label_id
 * @property string|null $runner_id
 * @property string $project_id
 * @property string|null $work_item_id
 * @property string|null $thread_id
 * @property string|null $head_sha
 * @property string|null $trigger_event_id
 * @property array<string, mixed> $context
 * @property int $attempt
 * @property CarbonImmutable|null $lease_expires_at
 * @property CarbonImmutable|null $retry_at
 * @property CarbonImmutable|null $started_at
 * @property CarbonImmutable|null $finished_at
 * @property array<string, mixed>|null $result
 * @property string|null $session_id
 * @property array<string, mixed>|null $usage
 * @property string|null $error
 * @property string|null $canceled_by
 * @property int $events_dropped
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read User $bot
 * @property-read Runner|null $runner
 * @property-read Project $project
 * @property-read WorkItem|null $workItem
 * @property-read AgentThread|null $thread
 */
#[Fillable([
    'type', 'status', 'waiting_reason', 'bot_id', 'cli', 'model', 'model_source', 'model_label_id', 'runner_id', 'project_id',
    'work_item_id', 'thread_id', 'head_sha', 'trigger_event_id', 'context', 'attempt', 'lease_expires_at', 'retry_at', 'started_at',
    'finished_at', 'result', 'session_id', 'usage', 'error', 'canceled_by', 'events_dropped',
])]
final class AgentRun extends Model
{
    /** @use HasFactory<AgentRunFactory> */
    use HasFactory, HasUlids;

    public const TYPES = RunType::VALUES;

    public const STATUSES = RunStatus::VALUES;

    /** Where the model of a run came from (spec 7.7): a model label, the project, the bot per kind, the bot's default. */
    public const MODEL_SOURCES = ['label', 'project', 'bot', 'default'];

    /** Why a run waits (A486): no runner of the pool has the CLI, or the runner of its strand is offline. */
    public const WAITING_REASONS = ['agent_off', 'no_cli', 'runner_offline'];

    /** What werkbuch writes into `error` itself; a runner's failure has its own sentence. */
    public const LOST = 'lost';

    protected function casts(): array
    {
        return [
            'type' => RunType::class,
            'status' => RunStatus::class,
            'cli' => AgentCli::class,
            'context' => 'array',
            'attempt' => 'integer',
            'lease_expires_at' => 'immutable_datetime',
            'retry_at' => 'immutable_datetime',
            'started_at' => 'immutable_datetime',
            'finished_at' => 'immutable_datetime',
            'result' => 'array',
            'usage' => 'array',
            'events_dropped' => 'integer',
        ];
    }

    /**
     * The runs the account sees: those of the projects it sees (never of a project being deleted).
     *
     * @param  Builder<AgentRun>  $query
     */
    public function scopeVisibleTo(Builder $query, User $user): void
    {
        $query->whereIn('agent_runs.project_id', Visibility::projectIds($user));
    }

    /** When the run has to end at the latest: its start and the fixed limit of its kind (spec 6.4). */
    public function deadline(): ?CarbonImmutable
    {
        return $this->started_at?->addMinutes($this->type->timeoutMinutes());
    }

    /** Whether werkbuch gives up on it: past its limit and one more lease without a result. */
    public function pastLimit(): bool
    {
        $deadline = $this->deadline();

        return $deadline !== null && $deadline->addSeconds(Protocol::LEASE_SECONDS)->isPast();
    }

    /** @return BelongsTo<User, $this> */
    public function bot(): BelongsTo
    {
        return $this->belongsTo(User::class, 'bot_id');
    }

    /** @return BelongsTo<Runner, $this> */
    public function runner(): BelongsTo
    {
        return $this->belongsTo(Runner::class);
    }

    /** @return BelongsTo<Project, $this> */
    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    /** @return BelongsTo<WorkItem, $this> */
    public function workItem(): BelongsTo
    {
        return $this->belongsTo(WorkItem::class);
    }

    /** @return BelongsTo<AgentThread, $this> */
    public function thread(): BelongsTo
    {
        return $this->belongsTo(AgentThread::class, 'thread_id');
    }

    /** @return HasMany<AgentRunEvent, $this> */
    public function events(): HasMany
    {
        return $this->hasMany(AgentRunEvent::class, 'run_id');
    }
}
