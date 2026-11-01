<?php

namespace App\Actions\WorkItems;

use App\Access\Authorize;
use App\Access\Visibility;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\RelationType;
use App\Models\User;
use App\Models\WorkItem;
use App\Models\WorkItemRelation;
use App\Support\Actor;
use App\Support\ItemLock;
use App\Support\RelationSnapshot;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Relates a work item to another one (spec 4.9), also in another project: the item is the source and reads the outward
 * label, the target the inward one (a type without an inward label is symmetric and reads the same from both ends).
 * Members and admins of the project of the source (`update`); the target only has to be visible. A target that does not
 * exist and one the account does not see are the same 422 at `target_id` (`field.target_id.unknown`): nothing tells
 * them apart.
 *
 * The locks of P1 for two items (ItemLock::pair, by id: A→B and B→A wait for each other in the same order), then under
 * them: an archived project of the source 409 `project_archived`, an archived source 409 `archived` (read-only, spec
 * 4.8; the target is the passive end and may be archived, it only gets its event and `updated_at`), the type (`field.type_id.unknown_relation`), the item
 * itself as target (`field.target_id.self`) and the same pair with the same type (`field.target_id.duplicate`; for a
 * symmetric type the other direction is the same pair), all field errors in one 422. The unique index of the table
 * only catches one direction; should it refuse the row anyway, that is the same 422. Both items get a new `updated_at`
 * and a `work_item.relation_added` with `changes.relation = {old: null, new: RelationSnapshot}` as each end reads it.
 * The transaction runs up to three times (two item rows: a deadlock is retried).
 */
final class AddRelation
{
    use AsAction;

    /**
     * @param  array<array-key, mixed>  $input  `type_id` (ULID), `target_id` (ULID or key)
     *
     * @throws Problem
     * @throws ValidationException
     */
    public function handle(Actor $actor, WorkItem $source, array $input): WorkItemRelation
    {
        Authorize::check($actor, 'update', $source);

        $target = self::target($input['target_id'] ?? null, $actor->user);

        try {
            return DB::transaction(function () use ($actor, $source, $target, $input): WorkItemRelation {
                [$source, $target] = ItemLock::pair($source, $target);

                if ($source->project->archived_at !== null) {
                    throw Problem::conflict('project_archived', [], __('problem.detail.project_archived'));
                }
                if ($source->archived_at !== null) {
                    throw Problem::conflict('archived', [], __('problem.detail.item_archived', ['key' => $source->key]));
                }

                $type = self::type($input['type_id'] ?? null);
                $errors = [];
                if ($type === null) {
                    $errors['type_id'] = __('field.type_id.unknown_relation');
                }
                if ($source->id === $target->id) {
                    $errors['target_id'] = __('field.target_id.self');
                } elseif ($type !== null && self::exists($type, $source, $target)) {
                    $errors['target_id'] = __('field.target_id.duplicate');
                }
                if ($type === null || $errors !== []) {
                    throw ValidationException::withMessages($errors);
                }

                $relation = WorkItemRelation::query()->create(['type_id' => $type->id, 'source_id' => $source->id, 'target_id' => $target->id]);
                $relation->setRelation('type', $type);

                $now = $source->freshTimestamp();
                foreach ([$source, $target] as $end) {
                    $end->updated_at = $now;
                    $end->save();
                    EventRecorder::record(EventType::WorkItemRelationAdded, $actor, $end, $end->project, [
                        'relation' => ['old' => null, 'new' => RelationSnapshot::of($relation, $end)],
                    ]);
                }

                return $relation;
            }, 3);
        } catch (UniqueConstraintViolationException) {
            throw ValidationException::withMessages(['target_id' => __('field.target_id.duplicate')]);
        }
    }

    /**
     * The target by ULID or key (any case, also with a former identifier), only when the account sees it.
     *
     * @throws ValidationException
     */
    private static function target(mixed $ref, User $reader): WorkItem
    {
        $target = is_string($ref) ? WorkItem::findByReference($ref) : null;

        if ($target === null || Visibility::roleIn($reader, $target->project) === null) {
            throw ValidationException::withMessages(['target_id' => __('field.target_id.unknown')]);
        }

        return $target;
    }

    /** The relation type by its ULID (any case); anything else is no type. */
    private static function type(mixed $id): ?RelationType
    {
        return is_string($id) && Str::isUlid($id) ? RelationType::query()->find(strtolower($id)) : null;
    }

    /** Whether the pair has a relation of the type already, for a symmetric type also the other way round. */
    private static function exists(RelationType $type, WorkItem $source, WorkItem $target): bool
    {
        $pair = fn (string $from, string $to) => fn ($query) => $query->where('source_id', $from)->where('target_id', $to);

        return WorkItemRelation::query()->where('type_id', $type->id)
            ->where(fn ($query) => $query->where($pair($source->id, $target->id))
                ->when($type->inward_label === null, fn ($query) => $query->orWhere($pair($target->id, $source->id))))
            // a locking read: it sees the latest commit even if a plain read started the snapshot before the locks
            ->sharedLock()
            ->exists();
    }
}
