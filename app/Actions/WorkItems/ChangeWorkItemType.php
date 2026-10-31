<?php

namespace App\Actions\WorkItems;

use App\Access\Authorize;
use App\Domain\WorkItems\Hierarchy;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\TypeProperty;
use App\Models\WorkItem;
use App\Support\Actor;
use App\Support\ItemInput;
use App\Support\ItemLock;
use App\Support\ItemValues;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Gives a work item another type (members and admins of the project, `item.edit`; spec 4.6). The type must be switched
 * on in the project and not archived (422 `type_id`); the two levels hold (spec 4.8): an item with children stays an
 * epic (422 `parent_not_epic`), an item with a parent becomes none (422 `epic_has_no_parent`), both at `type_id` with
 * a sentence naming the item. Values of properties the new type lacks are dropped (they stay in the history), the
 * values sent with the change come in, and the required properties of the new type must have a value (422
 * `values.<key>`); a new property nobody fills takes its default. The rich text is read before any lock; then the
 * locks of P1 (ItemLock::take) and everything checked against the item as locked; its children are counted under the
 * lock of the item, which every new child waits for (ItemInput reads a parent under a shared lock). An archived project
 * and an archived item are read-only (409 `project_archived`, `archived`).
 */
final class ChangeWorkItemType
{
    use AsAction;

    /**
     * @param  array<array-key, mixed>  $input  `type_id`, `values` (property key → value, optional)
     *
     * @throws ValidationException
     * @throws Problem
     */
    public function handle(Actor $actor, WorkItem $item, array $input): WorkItem
    {
        Authorize::check($actor, 'update', $item);

        // reading Markdown is the expensive step: never under a lock
        [$read, $refused] = ItemInput::documents(['values' => $input['values'] ?? []], $item->project);
        $id = $input['type_id'] ?? null;
        $id = is_string($id) && Str::isUlid($id) ? strtolower($id) : $id;

        $item = DB::transaction(function () use ($actor, $item, $id, $read, $refused): WorkItem {
            $locked = ItemLock::take($item);

            if ($locked->project->archived_at !== null) {
                throw Problem::conflict('project_archived', [], __('problem.detail.project_archived'));
            }
            if ($locked->archived_at !== null) {
                throw Problem::conflict('archived', [], __('problem.detail.item_archived', ['key' => $locked->key]));
            }
            if ($id === $locked->type_id) {
                return $locked;
            }

            self::retype($actor, $locked, $id, $read['values'], $refused);

            return $locked;
        });

        WorkItem::loadForResource($item, $actor->user);

        return $item;
    }

    /**
     * @param  array<string, list<string>>  $refused  the field errors of ItemInput::documents()
     *
     * @throws ValidationException
     * @throws Problem
     */
    private static function retype(Actor $actor, WorkItem $locked, mixed $id, mixed $sent, array $refused): void
    {
        $errors = $refused;
        $fail = function (string $field, string $message) use (&$errors): void {
            $errors[$field] ??= [$message];
        };

        $type = ItemInput::type($id, $locked->project, $fail);
        if ($type === null) {
            throw ValidationException::withMessages($errors);
        }

        $refusal = Hierarchy::typeChangeRefusal(
            WorkItem::query()->where('parent_id', $locked->id)->exists(),
            $locked->parent_id !== null,
            $type->is_epic,
        );
        if ($refusal !== null) {
            throw Problem::unprocessable($refusal->reason(), ['type_id' => [__("items.hierarchy.{$refusal->value}", ['key' => $locked->key])]]);
        }

        $locked->loadMissing('values.property');
        $before = ItemValues::of($locked);
        $keys = $type->typeProperties()->with('property')->get()->map(fn (TypeProperty $entry) => $entry->property->key)->all();
        $kept = array_intersect_key($before, array_flip($keys));

        $values = ItemInput::values($sent, $fail);
        $after = [];
        try {
            $after = ItemValues::check($locked->project, $type, $values, $kept, 'create');
        } catch (ValidationException $invalid) {
            // what documents() refused stays the error of its key (the value it left is empty)
            $errors += $invalid->errors();
        }
        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        $changes = ['type_id' => ['old' => $locked->type_id, 'new' => $type->id]];
        $all = array_unique([...array_keys($before), ...array_keys($after)]);
        sort($all, SORT_STRING);
        foreach ($all as $key) {
            if (json_encode($before[$key] ?? null) !== json_encode($after[$key] ?? null)) {
                $changes["values.{$key}"] = ['old' => $before[$key] ?? null, 'new' => $after[$key] ?? null];
            }
        }

        $locked->type_id = $type->id;
        $locked->setRelation('type', $type);
        $locked->updated_at = $locked->freshTimestamp();
        $locked->save();
        ItemValues::store($locked, $after, $before);

        EventRecorder::record(EventType::WorkItemUpdated, $actor, $locked, $locked->project, $changes);
    }
}
