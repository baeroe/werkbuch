<?php

namespace App\Models;

use App\Access\Visibility;
use App\Domain\Schedule\Schedule;
use Carbon\CarbonImmutable;
use Database\Factories\TemplateFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\MorphMany;
use Illuminate\Support\Carbon;

/**
 * A template of a project (spec 4.12): the fields of the work item it creates (`payload`: type, title with
 * placeholders, description as Tiptap JSON, fields, values and offsets of the dates) and optionally a schedule
 * (`schedule`, the normal form of Schedule::toArray()). `next_run_at` is when the scheduler next looks at it, `last_run_at`
 * the last scheduled term that ran, `run_count` how many scheduled runs there were (created or failed) and
 * `schedule_from` since when the schedule counts (A339). Who sees the project sees its templates (`visibleTo`); its
 * pictures are attachments it owns.
 *
 * @property string $id
 * @property string $project_id
 * @property string $name
 * @property array<string, mixed> $payload
 * @property array<string, mixed>|null $schedule
 * @property CarbonImmutable|null $schedule_from
 * @property CarbonImmutable|null $next_run_at
 * @property CarbonImmutable|null $last_run_at
 * @property int $run_count
 * @property string $created_by
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read Project $project
 * @property-read User $creator
 * @property-read EloquentCollection<int, TemplateRun> $runs
 * @property-read EloquentCollection<int, Attachment> $attachments
 */
#[Fillable(['project_id', 'name', 'payload', 'schedule', 'schedule_from', 'next_run_at', 'last_run_at', 'run_count', 'created_by'])]
final class Template extends Model
{
    /** @use HasFactory<TemplateFactory> */
    use HasFactory, HasUlids;

    /** With microseconds: `schedule_from` is datetime(6); MariaDB cuts them off for the columns without. */
    protected $dateFormat = 'Y-m-d H:i:s.u';

    /**
     * Only the templates of projects the account sees (never of one being deleted).
     *
     * @param  Builder<self>  $query
     */
    public function scopeVisibleTo(Builder $query, User $user): void
    {
        $query->whereIn('templates.project_id', Visibility::projectIds($user));
    }

    /** The schedule as stored, or null without one or when it cannot be read (any more). */
    public function schedule(): ?Schedule
    {
        return $this->schedule === null ? null : Schedule::read($this->schedule);
    }

    /**
     * @return BelongsTo<Project, $this>
     */
    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    /**
     * Its runs, newest first.
     *
     * @return HasMany<TemplateRun, $this>
     */
    public function runs(): HasMany
    {
        return $this->hasMany(TemplateRun::class)->orderByDesc('ran_at')->orderByDesc('id');
    }

    /**
     * The pictures and files of its description and rich text values.
     *
     * @return MorphMany<Attachment, $this>
     */
    public function attachments(): MorphMany
    {
        return $this->morphMany(Attachment::class, 'attachable');
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'payload' => 'array',
            'schedule' => 'array',
            'schedule_from' => 'immutable_datetime',
            'next_run_at' => 'immutable_datetime',
            'last_run_at' => 'immutable_datetime',
            'run_count' => 'int',
        ];
    }
}
