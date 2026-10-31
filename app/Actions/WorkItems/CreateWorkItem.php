<?php

namespace App\Actions\WorkItems;

use App\Access\Authorize;
use App\Domain\Ranking\Rank;
use App\Domain\Workflow\StateCategory;
use App\Domain\WorkItems\MoveStamps;
use App\Domain\WorkItems\ResolutionChoice;
use App\Domain\WorkItems\ResolutionRule;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Project;
use App\Models\Resolution;
use App\Models\User;
use App\Models\WorkflowState;
use App\Models\WorkItem;
use App\Models\WorkItemSubscriber;
use App\Support\Actor;
use App\Support\CatalogLock;
use App\Support\ItemInput;
use App\Support\ItemValues;
use App\Support\MemberInput;
use DateTimeImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Creates a work item (members and admins of the project, `item.create`) in the initial state of the project's
 * workflow: the next number of the project (never used again, even when the item goes), a rank after its last item,
 * labels, values, the creator (a person) and the assignee (a person) as watchers, and the event `work_item.created`.
 * The rich text is read before any lock; then the organization shared (no type or property goes meanwhile), then the
 * project `for update` (one number and one last rank at a time, P1), and every field checked under them. A refusal
 * leaves nothing behind: no item, no number used up, no event.
 */
final class CreateWorkItem
{
    use AsAction;

    /**
     * @param  array<array-key, mixed>  $input  `project_id` (ULID, identifier or former identifier), `type_id`, `title`, `description` or `description_json`, `assignee_id`, `priority`, `label_ids`, `start_date`, `due_date`, `parent_id` (ULID or key), `values` (property key → value)
     *
     * @throws ValidationException
     * @throws Problem
     */
    public function handle(Actor $actor, array $input): WorkItem
    {
        $reference = $input['project_id'] ?? null;
        if (! is_string($reference)) {
            throw ValidationException::withMessages(['project_id' => __('field.required')]);
        }

        $project = Project::findByReference($reference) ?? throw Problem::notFound();
        Authorize::check($actor, 'create', WorkItem::class, $project);

        // reading Markdown is the expensive step: never under a lock
        [$input, $refused] = ItemInput::documents($input, $project);

        return DB::transaction(function () use ($actor, $project, $input, $refused): WorkItem {
            CatalogLock::share();
            $project = MemberInput::lock($project);

            if ($project->archived_at !== null) {
                throw Problem::conflict('project_archived', [], __('problem.detail.project_archived'));
            }

            $fields = ItemInput::create($input, $project, $actor->user, $refused);
            ItemInput::assertTwoLevels($fields['type'], $fields['parent']);

            $number = $project->next_number + 1;
            // the counter only, without touching the project's updated_at
            Project::query()->whereKey($project->id)->toBase()->update(['next_number' => $number]);
            $last = WorkItem::query()->where('project_id', $project->id)->max('rank');

            $initial = WorkflowState::query()->findOrFail((string) $project->workflow()->value('initial_state_id'));
            $now = new DateTimeImmutable;
            // a new item comes from nowhere into its initial state, as from the backlog
            $stamps = MoveStamps::after(StateCategory::Backlog, $initial->category, null, null, $now);
            $choices = Resolution::query()->get()->map(fn (Resolution $resolution) => new ResolutionChoice(
                $resolution->id,
                StateCategory::tryFrom((string) $resolution->default_for),
                $resolution->position,
                $resolution->archived_at !== null,
            ));

            $item = WorkItem::query()->create([
                'project_id' => $project->id,
                'number' => $number,
                'type_id' => $fields['type']->id,
                'title' => $fields['title'],
                'description' => $fields['description']?->toJson(),
                'description_text' => $fields['description']?->toText(),
                'description_version' => 1,
                'state_id' => $initial->id,
                'resolution_id' => ResolutionRule::after(StateCategory::Backlog, $initial->category, null, null, array_values($choices->all())),
                'assignee_id' => $fields['assignee_id'],
                'priority' => $fields['priority'],
                'start_date' => $fields['start_date'],
                'due_date' => $fields['due_date'],
                'parent_id' => $fields['parent']?->id,
                'rank' => Rank::between(is_string($last) ? $last : null, null),
                'created_by' => $actor->user->id,
                'started_at' => $stamps['started_at'],
                'closed_at' => $stamps['closed_at'],
            ]);
            $item->setRelation('project', $project);

            $item->labels()->sync($fields['label_ids']);
            ItemValues::store($item, $fields['values'], []);

            self::watch($item, $actor->user, 'created');
            if ($fields['assignee_id'] !== null && $fields['assignee_id'] !== $actor->user->id) {
                self::watch($item, User::query()->findOrFail($fields['assignee_id']), 'assigned');
            }

            EventRecorder::record(EventType::WorkItemCreated, $actor, $item, $project, ['title' => ['old' => null, 'new' => $item->title]]);

            return $item;
        });
    }

    /** People watch the items they created or were given; bots get no notifications and watch nothing. */
    private static function watch(WorkItem $item, User $user, string $reason): void
    {
        if ($user->isPerson()) {
            WorkItemSubscriber::query()->create(['work_item_id' => $item->id, 'user_id' => $user->id, 'reason' => $reason]);
        }
    }
}
