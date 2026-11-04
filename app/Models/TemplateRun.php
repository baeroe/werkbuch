<?php

namespace App\Models;

use Carbon\CarbonImmutable;
use Database\Factories\TemplateRunFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A run of a template (spec 4.12): for a term of its schedule (`scheduled_for`, one run per term) or by hand
 * (`scheduled_for` null, `triggered_by` the person who pressed „Jetzt ausführen“, A338). It either created an item
 * (`created`, `work_item_id`, null once the item is deleted) or failed with a sentence in the language of the
 * organisation (`failed`, `error`).
 *
 * @property string $id
 * @property string $template_id
 * @property CarbonImmutable|null $scheduled_for
 * @property CarbonImmutable $ran_at
 * @property string $status
 * @property string|null $work_item_id
 * @property string|null $error
 * @property string|null $triggered_by
 * @property-read Template $template
 * @property-read WorkItem|null $workItem
 * @property-read User|null $trigger
 */
#[Fillable(['template_id', 'scheduled_for', 'ran_at', 'status', 'work_item_id', 'error', 'triggered_by'])]
final class TemplateRun extends Model
{
    /** @use HasFactory<TemplateRunFactory> */
    use HasFactory, HasUlids;

    /** The run created its item. */
    public const CREATED = 'created';

    /** The run could not create its item. */
    public const FAILED = 'failed';

    public $timestamps = false;

    /** With microseconds: `ran_at` is timestamp(6) (a log of runs in one second keeps its order). */
    protected $dateFormat = 'Y-m-d H:i:s.u';

    /**
     * @return BelongsTo<Template, $this>
     */
    public function template(): BelongsTo
    {
        return $this->belongsTo(Template::class);
    }

    /**
     * @return BelongsTo<WorkItem, $this>
     */
    public function workItem(): BelongsTo
    {
        return $this->belongsTo(WorkItem::class);
    }

    /**
     * Who ran the template by hand.
     *
     * @return BelongsTo<User, $this>
     */
    public function trigger(): BelongsTo
    {
        return $this->belongsTo(User::class, 'triggered_by');
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['scheduled_for' => 'immutable_datetime', 'ran_at' => 'immutable_datetime'];
    }
}
