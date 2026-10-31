<?php

namespace App\Actions\WorkItems;

use App\Access\Authorize;
use App\Domain\WorkItems\ItemKey;
use App\Exceptions\Problem;
use App\Models\Label;
use App\Models\WorkItem;
use App\Support\Actor;
use App\Support\ItemLock;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Applies one change to many work items (P10): each item follows its own rules, what they allow is changed, what they
 * refuse is named with its reason (`transition_not_allowed`, `not_closed`, `forbidden`, …) and the rest goes on. The
 * references and the form of the patch are checked once before anything (422 at `ids`, `patch`, `patch.<field>`);
 * then every item runs in a transaction of its own (`DB::transaction(…, 3)`, as every change that locks items): found
 * by ULID or key (unknown or invisible → `not_found`), the right `update` (`forbidden`), the locks of P1
 * (ItemLock::take), an archived project (`project_archived`). An archived item is read-only (`archived`) unless the
 * patch restores it (`archived: false`, RestoreWorkItem::apply; an item that is not archived → `not_archived`); the
 * fields and a move go through UpdateWorkItem::apply; `archived: true` archives after the patch
 * (ArchiveWorkItem::apply: the state after the patch must be closed, `not_closed`). A Problem or a ValidationException
 * rolls back only that item, the restore included (a refused patch leaves the item archived), and becomes
 * `{id: <the reference sent>, reason}` (`validation_failed` for field errors); anything else ends the request.
 *
 * A bulk edit takes no rich text: neither the description nor values (a key the patch does not know is a 422).
 */
final class BulkUpdateWorkItems
{
    use AsAction;

    /** At most this many items per request. */
    public const MAX_IDS = 100;

    /** What a bulk edit can change (`BulkPatch` of the clickdummy). */
    public const PATCH_KEYS = [
        'state_id', 'resolution_id', 'assignee_id', 'priority', 'label_ids', 'add_label_ids', 'remove_label_ids',
        'start_date', 'due_date', 'archived',
    ];

    /**
     * @param  array<array-key, mixed>  $input  `ids` (1–100 ULIDs or keys; duplicates merged) and `patch` (PATCH_KEYS)
     * @return array{updated: list<string>, rejected: list<array{id: string, reason: string}>}
     *
     * @throws ValidationException
     */
    public function handle(Actor $actor, array $input): array
    {
        $errors = [];
        $fail = function (string $field, string $message) use (&$errors): void {
            $errors[$field] ??= [$message];
        };
        $references = self::references($input['ids'] ?? null, $fail);
        [$fields, $archived, $add, $remove] = self::patch($input['patch'] ?? null, $fail);
        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        $updated = [];
        $rejected = [];
        $seen = [];
        foreach ($references as $reference) {
            try {
                $item = WorkItem::findByReference($reference) ?? throw Problem::notFound();
                // the same item by ULID and by key is one item: answered once, under the reference sent first
                if (isset($seen[$item->id])) {
                    continue;
                }
                $seen[$item->id] = true;

                Authorize::check($actor, 'update', $item);
                DB::transaction(function () use ($actor, $item, $fields, $archived, $add, $remove): void {
                    $locked = ItemLock::take($item);

                    if ($locked->project->archived_at !== null) {
                        throw Problem::conflict('project_archived', [], __('problem.detail.project_archived'));
                    }
                    if ($archived === false) {
                        RestoreWorkItem::apply($actor, $locked);
                    } elseif ($locked->archived_at !== null) {
                        throw Problem::conflict('archived', [], __('problem.detail.item_archived', ['key' => $locked->key]));
                    }

                    $patch = $fields;
                    if ($add !== null || $remove !== null) {
                        $patch['label_ids'] = self::labels($locked, $fields, $add ?? [], $remove ?? []);
                    }
                    if ($patch !== []) {
                        UpdateWorkItem::apply($actor, $locked, $patch);
                    }

                    if ($archived === true) {
                        ArchiveWorkItem::apply($actor, $locked);
                    }
                }, 3);

                $updated[] = $item->id;
            } catch (Problem $problem) {
                $rejected[] = ['id' => $reference, 'reason' => $problem->reason];
            } catch (ValidationException) {
                $rejected[] = ['id' => $reference, 'reason' => 'validation_failed'];
            }
        }

        return ['updated' => $updated, 'rejected' => $rejected];
    }

    /**
     * The references sent, each item reference once (a ULID in any case, a key in any case and with leading zeros), in
     * the order sent; 1 to MAX_IDS of them.
     *
     * @param  callable(string, string): void  $fail
     * @return list<string>
     */
    private static function references(mixed $ids, callable $fail): array
    {
        $references = [];
        if (is_array($ids) && array_is_list($ids)) {
            foreach ($ids as $reference) {
                $key = is_string($reference) && ! Str::isUlid($reference) ? ItemKey::parse($reference) : null;
                if (! is_string($reference) || (! Str::isUlid($reference) && $key === null)) {
                    $references = [];
                    break;
                }
                $references[$key === null ? strtolower($reference) : "{$key['identifier']}-{$key['number']}"] ??= $reference;
            }
        }

        if ($references === [] || count($references) > self::MAX_IDS) {
            $fail('ids', __('field.ids.invalid', ['max' => self::MAX_IDS]));

            return [];
        }

        return array_values($references);
    }

    /**
     * The form of the patch, checked once: an object of PATCH_KEYS (at least one), `archived` true or false, the labels
     * to add (existing) and to remove as lists of ULIDs. The fields go to UpdateWorkItem::apply as they came; it checks
     * them per item.
     *
     * @param  callable(string, string): void  $fail
     * @return array{0: array<string, mixed>, 1: ?bool, 2: ?list<string>, 3: ?list<string>}
     */
    private static function patch(mixed $patch, callable $fail): array
    {
        if (! is_array($patch) || $patch === [] || array_is_list($patch) || array_diff(array_keys($patch), self::PATCH_KEYS) !== []) {
            $fail('patch', __('field.patch.invalid', ['keys' => implode(', ', self::PATCH_KEYS)]));

            return [[], null, null, null];
        }

        $archived = null;
        if (array_key_exists('archived', $patch)) {
            $archived = $patch['archived'];
            if (! is_bool($archived)) {
                $fail('patch.archived', __('field.boolean'));
            }
        }
        $add = array_key_exists('add_label_ids', $patch) ? self::labelList($patch['add_label_ids'], 'patch.add_label_ids', true, $fail) : null;
        $remove = array_key_exists('remove_label_ids', $patch) ? self::labelList($patch['remove_label_ids'], 'patch.remove_label_ids', false, $fail) : null;

        /** @var array<string, mixed> $fields */
        $fields = array_diff_key($patch, array_flip(['archived', 'add_label_ids', 'remove_label_ids']));

        return [$fields, is_bool($archived) ? $archived : null, $add, $remove];
    }

    /**
     * Labels to add or remove: a list of ULIDs (`null` is none), in lower case and each once; the ones to add must
     * exist (removing one that is gone changes nothing).
     *
     * @param  callable(string, string): void  $fail
     * @return list<string>
     */
    private static function labelList(mixed $ids, string $field, bool $existing, callable $fail): array
    {
        $ids ??= [];
        if (! is_array($ids) || ! array_is_list($ids) || array_filter($ids, fn (mixed $id) => ! is_string($id) || ! Str::isUlid($id)) !== []) {
            $fail($field, __('field.label_ids.unknown'));

            return [];
        }

        /** @var list<string> $ids */
        $ids = array_values(array_unique(array_map(strtolower(...), $ids)));
        if ($existing && Label::query()->whereKey($ids)->count() !== count($ids)) {
            $fail($field, __('field.label_ids.unknown'));
        }

        return $ids;
    }

    /**
     * The labels of the item after the patch: the base (`label_ids` of the patch, else the item's own), the ones to add,
     * without the ones to remove. A base that is no list goes on as it came, for UpdateWorkItem::apply to refuse.
     *
     * @param  array<string, mixed>  $fields
     * @param  list<string>  $add
     * @param  list<string>  $remove
     */
    private static function labels(WorkItem $locked, array $fields, array $add, array $remove): mixed
    {
        $base = array_key_exists('label_ids', $fields) ? ($fields['label_ids'] ?? []) : $locked->labels()->pluck('labels.id')->all();
        if (! is_array($base) || ! array_is_list($base)) {
            return $base;
        }

        $base = array_map(fn (mixed $id) => is_string($id) && Str::isUlid($id) ? strtolower($id) : $id, $base);

        return array_values(array_filter([...$base, ...$add], fn (mixed $id) => ! in_array($id, $remove, true)));
    }
}
