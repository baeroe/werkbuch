<?php

namespace App\Actions\WorkItems;

use App\Access\Authorize;
use App\Domain\WorkItems\DateRange;
use App\Domain\WorkItems\ItemKey;
use App\Domain\WorkItems\Priority;
use App\Exceptions\Problem;
use App\Models\Label;
use App\Models\WorkItem;
use App\Support\Actor;
use App\Support\BotIds;
use App\Support\Ids;
use App\Support\ItemLock;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Applies one change to many work items (P10): each item follows its own rules, what they allow is changed, what they
 * refuse is named with its reason (`transition_not_allowed`, `not_closed`, `forbidden`, …) and the rest goes on. The
 * references and the form of the patch and of its values (a priority, a day, an id) are checked once before anything,
 * all errors in one 422 at `ids`, `patch`, `patch.<field>` and no item touched; then every item runs in a transaction
 * of its own (`DB::transaction(…, 3)`, as every change that locks items): found by ULID or key (unknown or invisible →
 * `not_found`), the right `update` (`forbidden`), the locks of P1 (ItemLock::take), an archived project
 * (`project_archived`). An archived item is read-only (`archived`) unless the patch restores it (`archived: false`,
 * RestoreWorkItem::apply; an item that is not archived → `not_archived`); the fields and a move go through
 * UpdateWorkItem::apply; `archived: true` archives after the patch (ArchiveWorkItem::apply: the state after the patch
 * must be closed, `not_closed`). A Problem or a ValidationException
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

        // whether the assignee is a bot, asked once for all items (`bot.assigned`, T10-M8)
        if (is_string($fields['assignee_id'] ?? null)) {
            app(BotIds::class)->preload([$fields['assignee_id']]);
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
     * to add (existing) and to remove as lists of ULIDs, the form of the fields (fieldForms). The fields go on to
     * UpdateWorkItem::apply, which checks them per item.
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
        $fields = self::fieldForms(array_diff_key($patch, array_flip(['archived', 'add_label_ids', 'remove_label_ids'])), $fail);

        return [$fields, is_bool($archived) ? $archived : null, $add, $remove];
    }

    /**
     * The form of the values, once for all items (a malformed one would be the same refusal for every item): a priority
     * of Priority, a day (`YYYY-MM-DD`) or `null` for the dates, a ULID in any case or `null` for the state, the
     * resolution and the assignee, a list of ULIDs (or `null`) for the labels. Whether they fit an item (a state of its
     * workflow, a member of its project, existing labels, the start before the due date) its patch answers. The ids go
     * on in lower case (Ids::normalize).
     *
     * @param  array<array-key, mixed>  $fields
     * @param  callable(string, string): void  $fail
     * @return array<string, mixed>
     */
    private static function fieldForms(array $fields, callable $fail): array
    {
        foreach (['state_id', 'resolution_id', 'assignee_id', 'label_ids'] as $field) {
            if (array_key_exists($field, $fields)) {
                $fields[$field] = Ids::normalize($fields[$field]);
            }
        }
        $sent = fn (string $field): bool => array_key_exists($field, $fields);
        $id = fn (mixed $value): bool => $value === null || (is_string($value) && Str::isUlid($value));

        if ($sent('priority') && (! is_string($fields['priority']) || Priority::tryFrom($fields['priority']) === null)) {
            $fail('patch.priority', __('field.priority.invalid'));
        }
        foreach (['start_date', 'due_date'] as $field) {
            if ($sent($field) && $fields[$field] !== null && (! is_string($fields[$field]) || ! DateRange::isDay($fields[$field]))) {
                $fail("patch.{$field}", __('field.date.invalid'));
            }
        }
        foreach (['state_id' => 'field.state_id.unknown', 'resolution_id' => 'field.resolution_id.unknown', 'assignee_id' => 'field.assignee_id.invalid'] as $field => $message) {
            if ($sent($field) && ! $id($fields[$field])) {
                $fail("patch.{$field}", __($message));
            }
        }
        if ($sent('label_ids') && $fields['label_ids'] !== null) {
            $labels = $fields['label_ids'];
            if (! is_array($labels) || ! array_is_list($labels) || array_filter($labels, fn (mixed $label) => ! is_string($label) || ! $id($label)) !== []) {
                $fail('patch.label_ids', __('field.label_ids.unknown'));
            }
        }

        /** @var array<string, mixed> $fields */
        return $fields;
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
     * The labels of the item after the patch: the base (`label_ids` of the patch, already a list of ULIDs in lower case,
     * else the item's own), the ones to add, without the ones to remove.
     *
     * @param  array<string, mixed>  $fields
     * @param  list<string>  $add
     * @param  list<string>  $remove
     * @return list<string>
     */
    private static function labels(WorkItem $locked, array $fields, array $add, array $remove): array
    {
        /** @var list<string> $base */
        $base = array_key_exists('label_ids', $fields) ? ($fields['label_ids'] ?? []) : $locked->labels()->pluck('labels.id')->all();

        return array_values(array_filter([...$base, ...$add], fn (string $id) => ! in_array($id, $remove, true)));
    }
}
