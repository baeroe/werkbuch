<?php

namespace App\Actions\WorkItems;

use App\Access\Authorize;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Http\Resources\WorkItemResource;
use App\Models\Event;
use App\Models\User;
use App\Models\WorkItem;
use App\Models\WorkItemSubscriber;
use App\Support\Actor;
use App\Support\ItemInput;
use App\Support\ItemLock;
use App\Support\ItemValues;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Changes fields of a work item (members and admins of the project, `item.edit`): only what the input sends, all of it
 * checked before anything changes. The rich text is read before any lock; then the locks of P1 (ItemLock::take: the
 * organization shared, the project shared, the item `for update`), and everything checked against the item as locked.
 * An archived project and an archived item are read-only (409 `project_archived`, `archived`).
 *
 * The description has a version (P3): it counts up with every change of the description. A client that names the
 * version it edited (`base_description_version`) gets a 409 `description_conflict` with the item as it is now
 * (`current`) and the name of whoever changed the description last, when it has moved on meanwhile; without a version
 * the last write wins (spec 4.8). The check runs under the lock of the item, so of two edits on the same version the
 * second one always sees the first.
 */
final class UpdateWorkItem
{
    use AsAction;

    /**
     * @param  array<array-key, mixed>  $input  `title`, `description` or `description_json`, `base_description_version`, `priority`, `label_ids`, `start_date`, `due_date`, `parent_id` (ULID or key), `values` (property key → value; only the keys sent), `rank`, `assignee_id`, `state_id` and `resolution_id` (a move, TransitionWorkItem)
     *
     * @throws ValidationException
     * @throws Problem
     */
    public function handle(Actor $actor, WorkItem $item, array $input): WorkItem
    {
        Authorize::check($actor, 'update', $item);

        // reading Markdown is the expensive step: never under a lock
        [$input, $refused] = ItemInput::documents($input, $item->project);

        $item = DB::transaction(function () use ($actor, $item, $input, $refused): WorkItem {
            $locked = ItemLock::take($item);

            if ($locked->project->archived_at !== null) {
                throw Problem::conflict('project_archived', [], __('problem.detail.project_archived'));
            }
            if ($locked->archived_at !== null) {
                throw Problem::conflict('archived', [], __('problem.detail.item_archived', ['key' => $locked->key]));
            }

            self::apply($actor, $locked, $input, refused: $refused);

            return $locked;
        });

        WorkItem::loadForResource($item, $actor->user);

        return $item;
    }

    /**
     * Applies a change to an item the caller has locked (ItemLock) and may change: no right, no lock and no archive
     * check here (BulkUpdateWorkItems checks those per item). Everything is checked before the first change. Then the
     * fields that really change are written: a new description counts its version up and refreshes its text for the
     * search; **one** `work_item.updated` names the changes as `{old, new}` (`values.<key>`, `label_ids` as lists in
     * catalog order, `description` as Tiptap JSON, `rank`); a new assignee is a `work_item.assigned` of its own
     * (`changes.assignee_id`) and watches the item from now on (reason `assigned`), even after unsubscribing before
     * (spec 4.10). A `state_id` or `resolution_id` is a move (TransitionWorkItem::move()): checked with the rest, made
     * after the fields (its own `work_item.state_changed`). `updated_at` moves only when something changed. `$reason`
     * notes why in the events (an automation).
     *
     * @param  array<array-key, mixed>  $input  as ItemInput::documents() answers it (read before the locks)
     * @param  array<string, list<string>>  $refused  the field errors of ItemInput::documents()
     * @return bool whether anything changed
     *
     * @throws ValidationException
     * @throws Problem
     */
    public static function apply(Actor $actor, WorkItem $locked, array $input, ?string $reason = null, array $refused = []): bool
    {
        $locked->loadMissing(['type', 'labels:labels.id', 'values.property']);
        $fields = ItemInput::patch($input, $locked, $actor->user, $refused);

        $parent = $fields['parent'] ?? null;
        if ($parent !== null) {
            ItemInput::assertTwoLevels($locked->type, $parent);
        }

        $document = $fields['description'] ?? null;
        $description = array_key_exists('description', $fields) ? $document?->toJson() : $locked->description;
        $descriptionChanged = json_encode($description) !== json_encode($locked->description);
        $base = $fields['base_description_version'] ?? null;
        if ($descriptionChanged && $base !== null && $base !== $locked->description_version) {
            throw self::conflict($actor, $locked);
        }

        // a move (`state_id`, `resolution_id`) is checked with the rest and made after the fields, like a transition
        $moving = array_key_exists('state_id', $input) || array_key_exists('resolution_id', $input);
        $state = array_key_exists('state_id', $input) ? $input['state_id'] : $locked->state_id;
        $state = is_string($state) ? $state : '';
        $resolution = TransitionWorkItem::resolutionOf($input['resolution_id'] ?? null);
        if ($moving) {
            TransitionWorkItem::check($locked, $state, $resolution);
        }

        $actor = $reason === null ? $actor : new Actor($actor->user, $actor->via, $reason, $actor->token);
        $changes = [];
        $record = function (string $field, mixed $old, mixed $new) use (&$changes): void {
            if (json_encode($old) !== json_encode($new)) {
                $changes[$field] = ['old' => $old, 'new' => $new];
            }
        };

        if (array_key_exists('title', $fields)) {
            $record('title', $locked->title, $fields['title']);
            $locked->title = $fields['title'];
        }
        if (array_key_exists('priority', $fields)) {
            $record('priority', $locked->priority->value, $fields['priority']->value);
            $locked->priority = $fields['priority'];
        }
        if (array_key_exists('start_date', $fields)) {
            $record('start_date', $locked->start_date?->format('Y-m-d'), $fields['start_date']);
            $locked->setAttribute('start_date', $fields['start_date']);
        }
        if (array_key_exists('due_date', $fields)) {
            $record('due_date', $locked->due_date?->format('Y-m-d'), $fields['due_date']);
            $locked->setAttribute('due_date', $fields['due_date']);
        }
        if (array_key_exists('parent', $fields)) {
            $record('parent_id', $locked->parent_id, $parent?->id);
            $locked->parent_id = $parent?->id;
        }
        if ($descriptionChanged) {
            $record('description', $locked->description, $description);
            $locked->description = $description;
            $locked->description_text = $document?->toText();
            $locked->description_version += 1;
        }
        if (array_key_exists('rank', $fields)) {
            $record('rank', $locked->rank, $fields['rank']);
            $locked->rank = $fields['rank'];
        }

        if (array_key_exists('label_ids', $fields)) {
            $labels = $fields['label_ids'];
            sort($labels, SORT_STRING);
            $record('label_ids', $locked->labels->modelKeys(), $labels);
            if (isset($changes['label_ids'])) {
                $locked->labels()->sync($labels);
            }
        }

        if (array_key_exists('values', $fields)) {
            $before = ItemValues::of($locked);
            $after = $fields['values'];
            $keys = array_unique([...array_keys($before), ...array_keys($after)]);
            sort($keys, SORT_STRING);
            foreach ($keys as $key) {
                $record("values.{$key}", $before[$key] ?? null, $after[$key] ?? null);
            }
            ItemValues::store($locked, $after, $before);
        }

        $assignee = array_key_exists('assignee_id', $fields) && $fields['assignee_id'] !== $locked->assignee_id;
        $previous = $locked->assignee_id;
        if ($assignee) {
            $locked->assignee_id = $fields['assignee_id'];
        }

        $changed = $changes !== [] || $assignee;
        if ($changed) {
            $locked->updated_at = $locked->freshTimestamp();
            $locked->save();
        }

        if ($changes !== []) {
            EventRecorder::record(EventType::WorkItemUpdated, $actor, $locked, $locked->project, $changes);
        }
        if ($assignee) {
            self::watch($locked, $locked->assignee_id);
            EventRecorder::record(EventType::WorkItemAssigned, $actor, $locked, $locked->project, ['assignee_id' => ['old' => $previous, 'new' => $locked->assignee_id]]);
        }

        if ($moving) {
            $changed = TransitionWorkItem::move($actor, $locked, $state, $resolution, $reason) || $changed;
        }

        return $changed;
    }

    /**
     * The 409 of a description edited on an old version: the item as it is now, for the reader who sent the change
     * (K5), and who changed the description last (whoever recorded the last change of it; "someone" when no event says).
     */
    private static function conflict(Actor $actor, WorkItem $locked): Problem
    {
        $editor = Event::query()
            ->where('subject_type', $locked->getMorphClass())->where('subject_id', $locked->id)
            ->whereJsonContainsKey('changes->description')
            ->orderByDesc('occurred_at')->orderByDesc('id')
            ->first()?->actor;

        WorkItem::loadForResource($locked, $actor->user);

        return Problem::conflict(
            'description_conflict',
            ['current' => (new WorkItemResource($locked))->resolve()],
            __('problem.detail.description_conflict', ['name' => $editor->name ?? __('items.someone')]),
        );
    }

    /**
     * The new assignee watches the item (reason `assigned`); an earlier unsubscription is lifted (spec 4.10). Bots get
     * no notifications and watch nothing; a person who watches already keeps the reason they have.
     */
    private static function watch(WorkItem $item, ?string $assigneeId): void
    {
        $assignee = $assigneeId === null ? null : User::query()->find($assigneeId);
        if ($assignee === null || ! $assignee->isPerson()) {
            return;
        }

        $row = WorkItemSubscriber::query()->where('work_item_id', $item->id)->where('user_id', $assignee->id)->first();
        if ($row === null) {
            WorkItemSubscriber::query()->create(['work_item_id' => $item->id, 'user_id' => $assignee->id, 'reason' => 'assigned']);
        } elseif ($row->unsubscribed_at !== null) {
            $row->update(['reason' => 'assigned', 'unsubscribed_at' => null]);
        }
    }
}
