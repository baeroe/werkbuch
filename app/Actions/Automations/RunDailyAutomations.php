<?php

namespace App\Actions\Automations;

use App\Actions\Comments\AddComment;
use App\Actions\WorkItems\ArchiveWorkItem;
use App\Actions\WorkItems\TransitionWorkItem;
use App\Domain\Automations\AutomationKey;
use App\Domain\Automations\NightlyRun;
use App\Domain\Workflow\StateCategory;
use App\Exceptions\Problem;
use App\Models\Automation;
use App\Models\Comment;
use App\Models\Organization;
use App\Models\Project;
use App\Models\WorkflowState;
use App\Models\WorkItem;
use App\Support\Actor;
use App\Support\ItemLock;
use Carbon\CarbonImmutable;
use Closure;
use DateTimeZone;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;
use RuntimeException;

/**
 * The nightly automations (spec 4.13, A343, A344): the hourly RunDailyAutomationsJob acts in the hour 03:00–03:59 in the
 * zone of the organisation (NightlyRun) and in no other, unless forced (`app:run-automations --now`). In every project
 * that is neither archived nor being deleted, with the automation switched on (`$projectId` names one project, e2e, K9):
 *
 * - Auto-Archiv: the default bot archives the items in a Completed or Canceled state that closed at least `days` days
 *   ago (ArchiveWorkItem::apply, reason `auto_archive`).
 * - Auto-Close: the default bot moves the items in Backlog or Unstarted whose last activity, the later of `updated_at`
 *   and their last comment (A344, K11: an item without a comment counts its `updated_at`), lies at least `days` days
 *   back into the Canceled state of its settings, with the transitions of the workflow (TransitionWorkItem::move,
 *   reason `auto_close`), then comments why in the language of the organisation as the same actor. A move the workflow
 *   does not allow (409 `transition_not_allowed`, or a 422 of the move) skips the item and writes nothing. A state that
 *   is no Canceled state of the current workflow (K11) passes the project over and is reported.
 *
 * Candidates in blocks of BLOCK by ID, read without a lock; each item in a transaction of its own (`DB::transaction(…,
 * 3)`, the locks of P1 through ItemLock::take) that checks it again as locked: an item gone or a project being deleted
 * meanwhile is passed over. The text of the comment is built once per project as Tiptap JSON, never read as Markdown
 * under a lock (K18). A second run the same night finds nothing more to do: archived items and canceled ones are no
 * candidates. A system action without an event of its own.
 */
final class RunDailyAutomations
{
    use AsAction;

    public const BLOCK = 200;

    /** The last activity of an item: its own change or its last comment, whichever is later (K11). */
    private const ACTIVITY = 'greatest(work_items.updated_at, coalesce((select max(comments.created_at) from comments where comments.work_item_id = work_items.id), work_items.updated_at))';

    /**
     * @return array{archived: int, closed: int, skipped: int}
     */
    public function handle(Actor $actor, CarbonImmutable $hourUtc, bool $force = false, ?string $projectId = null): array
    {
        $counts = ['archived' => 0, 'closed' => 0, 'skipped' => 0];
        $organization = Organization::current();
        if (! $force && ! NightlyRun::isDue($hourUtc->toDateTimeImmutable(), new DateTimeZone($organization->timezone))) {
            return $counts;
        }

        $automations = Automation::query()
            ->where('enabled', true)
            ->whereIn('key', [AutomationKey::AutoArchive, AutomationKey::AutoClose])
            ->when($projectId !== null, fn (Builder $query) => $query->where('project_id', $projectId))
            ->whereHas('project', fn (Builder $query) => $query->whereNull('archived_at')->whereNull('deleting_at'))
            ->with('project')
            ->orderBy('project_id')->orderBy('key')
            ->get();

        foreach ($automations as $automation) {
            $days = self::days($automation);

            if ($automation->key === AutomationKey::AutoArchive) {
                $counts['archived'] += self::archive($automation->project, $days);
            } else {
                ['closed' => $closed, 'skipped' => $skipped] = self::close($automation->project, $days, $automation->settings['state_id'] ?? null, $organization->locale->value);
                $counts['closed'] += $closed;
                $counts['skipped'] += $skipped;
            }
        }

        return $counts;
    }

    private static function archive(Project $project, int $days): int
    {
        $cutoff = now()->subDays($days);
        $closed = self::states($project, [StateCategory::Completed, StateCategory::Canceled]);
        $bot = Actor::automation('auto_archive');
        $archived = 0;

        self::each(
            WorkItem::query()->where('project_id', $project->id)->whereNull('archived_at')->whereIn('state_id', $closed)->where('closed_at', '<=', $cutoff),
            function (WorkItem $locked) use ($bot, $cutoff, $closed): string {
                if ($locked->archived_at !== null || ! in_array($locked->state_id, $closed, true) || $locked->closed_at === null || $locked->closed_at->gt($cutoff)) {
                    return 'none';
                }

                return ArchiveWorkItem::apply($bot, $locked) ? 'done' : 'none';
            },
            function (string $outcome) use (&$archived): void {
                $archived += $outcome === 'done' ? 1 : 0;
            },
        );

        return $archived;
    }

    /**
     * @return array{closed: int, skipped: int}
     */
    private static function close(Project $project, int $days, mixed $stateId, string $locale): array
    {
        $counts = ['closed' => 0, 'skipped' => 0];
        $target = is_string($stateId) ? WorkflowState::query()->whereKey($stateId)->where('workflow_id', $project->workflow_id)
            ->where('category', StateCategory::Canceled)->first() : null;
        if ($target === null) {
            report(new RuntimeException("Auto-Close of project {$project->identifier} names no Canceled state of its workflow; the project was passed over."));

            return $counts;
        }

        $cutoff = now()->subDays($days);
        $open = self::states($project, [StateCategory::Backlog, StateCategory::Unstarted]);
        $bot = Actor::automation('auto_close');
        $text = $days === 1
            ? __('automations.auto_close.comment.one', ['days' => $days], $locale)
            : __('automations.auto_close.comment.other', ['days' => $days], $locale);
        $body = ['type' => 'doc', 'content' => [['type' => 'paragraph', 'content' => [['type' => 'text', 'text' => $text]]]]];

        self::each(
            WorkItem::query()->where('project_id', $project->id)->whereNull('archived_at')->whereIn('state_id', $open)
                ->whereRaw(self::ACTIVITY.' <= ?', [$cutoff->format('Y-m-d H:i:s.u')]),
            function (WorkItem $locked) use ($bot, $cutoff, $open, $target, $body): string {
                if ($locked->archived_at !== null || ! in_array($locked->state_id, $open, true) || self::active($locked, $cutoff)) {
                    return 'none';
                }

                TransitionWorkItem::move($bot, $locked, $target->id, null);
                AddComment::run($bot, $locked, ['body_json' => $body]);

                return 'done';
            },
            function (string $outcome) use (&$counts): void {
                match ($outcome) {
                    'done' => $counts['closed']++,
                    'skipped' => $counts['skipped']++,
                    default => null,
                };
            },
        );

        return $counts;
    }

    /**
     * Each candidate in a transaction of its own, locked and checked again by `$work` (`done` or `none`); a refusal
     * (409 `transition_not_allowed` or another conflict, a 422 of the move) is `skipped` and leaves nothing behind, an
     * item gone or a project being deleted meanwhile (404) `none`. `$tally` hears each.
     *
     * @param  Builder<WorkItem>  $candidates
     * @param  Closure(WorkItem): string  $work
     * @param  Closure(string): void  $tally
     */
    private static function each(Builder $candidates, Closure $work, Closure $tally): void
    {
        $candidates->select('work_items.*')->chunkById(self::BLOCK, function (Collection $items) use ($work, $tally): void {
            foreach ($items as $item) {
                try {
                    $outcome = DB::transaction(function () use ($item, $work): string {
                        $locked = ItemLock::take($item);

                        return $locked->project->archived_at === null ? $work($locked) : 'none';
                    }, 3);
                } catch (Problem|ValidationException $refusal) {
                    $outcome = $refusal instanceof Problem && $refusal->status === 404 ? 'none' : 'skipped';
                }

                $tally($outcome);
            }
        }, 'work_items.id', 'id');
    }

    /** Whether the item, as locked, saw activity after the cutoff: a change of its own or a comment. */
    private static function active(WorkItem $locked, Carbon $cutoff): bool
    {
        return $locked->updated_at?->gt($cutoff) === true
            || Comment::query()->where('work_item_id', $locked->id)->where('created_at', '>', $cutoff)->exists();
    }

    /**
     * The states of the project's workflow in these categories.
     *
     * @param  list<StateCategory>  $categories
     * @return list<string>
     */
    private static function states(Project $project, array $categories): array
    {
        return array_values(WorkflowState::query()->where('workflow_id', $project->workflow_id)->whereIn('category', $categories)->pluck('id')->all());
    }

    /** The days of an automation's settings, its default when they hold none. */
    private static function days(Automation $automation): int
    {
        $days = $automation->settings['days'] ?? null;

        return is_int($days) ? $days : (int) $automation->key->defaults()['days'];
    }
}
