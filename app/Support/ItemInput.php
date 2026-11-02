<?php

namespace App\Support;

use App\Access\Assignable;
use App\Access\Visibility;
use App\Domain\Ranking\Rank;
use App\Domain\WorkItems\DateRange;
use App\Domain\WorkItems\Hierarchy;
use App\Domain\WorkItems\Priority;
use App\Exceptions\Problem;
use App\Models\Label;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use App\Models\WorkItemType;
use App\RichText\Document;
use App\RichText\RichTextInput;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * The fields of a work item as the actions that write them check them (spec 4.4, the checks of `itemRules.ts`), with
 * their field messages (P9). Every field error of one input comes in one ValidationException, the values of the
 * properties (ItemValues) included. Callers read the rich text with documents() before their locks and check the rest
 * with create() or patch() under them.
 */
final class ItemInput
{
    public const TITLE_MAX = 255;

    /** The length of `work_items.rank`. */
    public const RANK_MAX = 128;

    /**
     * The input with its rich text read, before any lock: `description` (or `description_json`) becomes a Document or
     * `null` under `description`, the rich text values become Documents (ItemValues::documents()). Both went through
     * the rules of saving (RichTextRules) for the writer against the text of `$item` as it is now (none for a new item),
     * also read here. What cannot be read or is refused comes back as field errors, for create() to report with all the
     * others. The third part names the texts that were sent by the key that sent them (`description` or
     * `description_json`, `values.<key>`), for AttachmentLinks and the mentions under the lock.
     *
     * @param  array<array-key, mixed>  $input
     * @return array{0: array<array-key, mixed>, 1: array<string, list<string>>, 2: array<string, Document>}
     */
    public static function documents(array $input, Project $project, Actor $actor, ?WorkItem $item = null): array
    {
        $errors = [];
        $texts = [];

        if (RichTextInput::given($input, 'description')) {
            $before = $item?->description === null ? null : Document::fromJson($item->description);
            $key = array_key_exists('description', $input) ? 'description' : 'description_json';
            try {
                $description = RichTextInput::from($input, 'description', RichTextRules::context($project, $actor->user, $before));
            } catch (ValidationException $invalid) {
                $description = null;
                $errors = $invalid->errors();
            }
            unset($input['description_json']);
            $input['description'] = $description;
            if ($description !== null) {
                $texts[$key] = $description;
            }
        }

        if (is_array($input['values'] ?? null)) {
            $before = $item === null ? [] : ItemValues::documentsOf($item->loadMissing('values.property'));
            [$input['values'], $refused] = ItemValues::documents($input['values'], $project, $actor->user, $before);
            $errors = [...$errors, ...$refused];
            foreach ($input['values'] as $key => $value) {
                if ($value instanceof Document) {
                    $texts["values.{$key}"] = $value;
                }
            }
        }

        return [$input, $errors, $texts];
    }

    /**
     * The fields of a new item in the project, checked under the locks of the caller: the type (the default type of
     * the project unless named; switched on and active), the title (trimmed, 1–255 characters), the description (a
     * Document from documents()), the priority (`none` unless named), the labels (existing, each once), start and due
     * date (days, the start not after the due date), the assignee (`Assignable`), the parent (an item of the project,
     * by ULID or key; one of another project the reader does not see is unknown) and the values (ItemValues).
     *
     * @param  array<array-key, mixed>  $input  as documents() answers it
     * @param  array<string, list<string>>  $refused  the field errors of documents()
     * @return array{type: WorkItemType, title: string, description: ?Document, priority: Priority, label_ids: list<string>, start_date: ?string, due_date: ?string, assignee_id: ?string, parent: ?WorkItem, values: array<string, mixed>}
     *
     * @throws ValidationException
     */
    public static function create(array $input, Project $project, User $reader, array $refused = []): array
    {
        $errors = $refused;
        $fail = function (string $field, string $message) use (&$errors): void {
            $errors[$field] ??= [$message];
        };

        $type = self::type($input['type_id'] ?? $project->default_type_id, $project, $fail);
        $title = self::title($input['title'] ?? null, $fail);
        $start = self::day($input, 'start_date', $fail);
        $due = self::day($input, 'due_date', $fail);
        if (DateRange::startAfterDue($start, $due)) {
            $fail('due_date', __('field.due_date.before_start'));
        }

        $values = [];
        if ($type !== null) {
            try {
                $values = ItemValues::check($project, $type, self::values($input['values'] ?? [], $fail), [], 'create');
            } catch (ValidationException $invalid) {
                // what documents() refused stays the error of its key (the value it left is empty)
                $errors += $invalid->errors();
            }
        }

        $fields = [
            'title' => $title,
            'description' => ($input['description'] ?? null) instanceof Document ? $input['description'] : null,
            'priority' => self::priority($input['priority'] ?? null, $fail),
            'label_ids' => self::labels($input['label_ids'] ?? null, $fail),
            'start_date' => $start,
            'due_date' => $due,
            'assignee_id' => self::assignee($input['assignee_id'] ?? null, $project, $fail),
            'parent' => self::parent($input['parent_id'] ?? null, $project, $reader, $fail),
            'values' => $values,
        ];

        if ($errors !== [] || $type === null) {
            throw ValidationException::withMessages($errors);
        }

        return ['type' => $type, ...$fields];
    }

    /**
     * The fields a change of the item sends, checked under the locks of the caller against the item as locked; what the
     * input leaves out stays out of the answer (a PATCH changes only what it sends). The same rules as create(), and:
     * `null` clears the description, the dates, the parent and the assignee; a new start or due date is checked against
     * the other one as stored; an assignee or parent the item already has is no new pick and is not checked again; the
     * item is never its own parent; `values` checks only the keys sent (ItemValues in mode `update`: a property that
     * became required later may stay empty) and answers all values afterwards; `rank` is a valid rank of at most 128
     * characters (`work_items.rank`); `base_description_version` is the version of the description the client edited.
     *
     * @param  array<array-key, mixed>  $input  as documents() answers it
     * @param  array<string, list<string>>  $refused  the field errors of documents()
     * @return array{title?: string, description?: ?Document, priority?: Priority, label_ids?: list<string>, start_date?: ?string, due_date?: ?string, assignee_id?: ?string, parent?: ?WorkItem, values?: array<string, mixed>, rank?: string, base_description_version?: ?int}
     *
     * @throws ValidationException
     */
    public static function patch(array $input, WorkItem $locked, User $reader, array $refused = []): array
    {
        $errors = $refused;
        $fail = function (string $field, string $message) use (&$errors): void {
            $errors[$field] ??= [$message];
        };
        $sent = fn (string $field): bool => array_key_exists($field, $input);
        $project = $locked->project;
        $fields = [];

        if ($sent('title')) {
            $fields['title'] = self::title($input['title'], $fail);
        }
        if ($sent('description')) {
            $fields['description'] = $input['description'] instanceof Document ? $input['description'] : null;
        }
        if ($sent('base_description_version')) {
            $version = $input['base_description_version'];
            if ($version !== null && (! is_int($version) || $version < 1)) {
                $fail('base_description_version', __('field.base_description_version.invalid'));
            }
            $fields['base_description_version'] = is_int($version) ? $version : null;
        }
        if ($sent('priority')) {
            // `none` is no priority; `null` is no priority name
            $fields['priority'] = self::priority($input['priority'] ?? false, $fail);
        }
        if ($sent('label_ids')) {
            $fields['label_ids'] = self::labels($input['label_ids'], $fail);
        }

        if ($sent('start_date') || $sent('due_date')) {
            $start = $sent('start_date') ? self::day($input, 'start_date', $fail) : $locked->start_date?->format('Y-m-d');
            $due = $sent('due_date') ? self::day($input, 'due_date', $fail) : $locked->due_date?->format('Y-m-d');
            if (DateRange::startAfterDue($start, $due)) {
                $fail('due_date', __('field.due_date.before_start'));
            }
            if ($sent('start_date')) {
                $fields['start_date'] = $start;
            }
            if ($sent('due_date')) {
                $fields['due_date'] = $due;
            }
        }

        if ($sent('assignee_id')) {
            $id = Ids::normalize($input['assignee_id']);
            $fields['assignee_id'] = $id === $locked->assignee_id ? $id : self::assignee($id, $project, $fail);
        }

        if ($sent('parent_id')) {
            $parent = self::parent($input['parent_id'], $project, $reader, $fail);
            if ($parent?->id === $locked->id) {
                $fail('parent_id', __('field.parent_id.self'));
            }
            $fields['parent'] = $parent;
        }

        if ($sent('values')) {
            try {
                $fields['values'] = ItemValues::check($project, $locked->type, self::values($input['values'], $fail), ItemValues::of($locked), 'update');
            } catch (ValidationException $invalid) {
                $errors += $invalid->errors();
            }
        }

        if ($sent('rank')) {
            $rank = $input['rank'];
            if (! is_string($rank) || strlen($rank) > self::RANK_MAX || ! Rank::isValid($rank)) {
                $fail('rank', __('field.rank.invalid'));
            }
            $fields['rank'] = is_string($rank) ? $rank : '';
        }

        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        return $fields;
    }

    /**
     * Two levels (spec 4.8): an epic has no parent, and only an epic has children. A 422 at `parent_id` with a reason
     * of its own, after the field checks.
     *
     * @throws Problem
     */
    public static function assertTwoLevels(WorkItemType $type, ?WorkItem $parent): void
    {
        if ($parent === null) {
            return;
        }

        $refuse = fn (string $reason) => Problem::unprocessable($reason, ['parent_id' => [__("problem.reason.{$reason}")]]);

        if (! Hierarchy::canHaveParent($type->is_epic)) {
            throw $refuse('epic_has_no_parent');
        }
        if (! Hierarchy::canHaveChildren($parent->type->is_epic)) {
            throw $refuse('parent_not_epic');
        }
    }

    /**
     * A type for an item of the project (ChangeWorkItemType as well): switched on in the project and not archived.
     *
     * @param  callable(string, string): void  $fail
     */
    public static function type(mixed $id, Project $project, callable $fail): ?WorkItemType
    {
        $id = is_string($id) && Str::isUlid($id) ? strtolower($id) : null;
        $type = $id === null ? null : $project->types()->whereKey($id)->first();

        if ($type === null) {
            $fail('type_id', __('field.type_id.disabled'));
        } elseif ($type->archived_at !== null) {
            $fail('type_id', __('field.type_id.archived'));
        } else {
            return $type;
        }

        return null;
    }

    /**
     * @param  callable(string, string): void  $fail
     */
    private static function title(mixed $title, callable $fail): string
    {
        $title = is_string($title) ? trim($title) : '';

        if ($title === '') {
            $fail('title', __('field.title.required'));
        } elseif (mb_strlen($title) > self::TITLE_MAX) {
            $fail('title', __('field.title.max', ['max' => self::TITLE_MAX]));
        }

        return $title;
    }

    /**
     * @param  callable(string, string): void  $fail
     */
    private static function priority(mixed $priority, callable $fail): Priority
    {
        if ($priority === null) {
            return Priority::None;
        }

        $known = is_string($priority) ? Priority::tryFrom($priority) : null;
        if ($known === null) {
            $fail('priority', __('field.priority.invalid'));
        }

        return $known ?? Priority::None;
    }

    /**
     * The labels each once, in the order sent.
     *
     * @param  callable(string, string): void  $fail
     * @return list<string>
     */
    private static function labels(mixed $ids, callable $fail): array
    {
        $ids ??= [];
        // a canonical ULID only: the collation would let a look-alike pass `whereKey`
        if (! is_array($ids) || ! array_is_list($ids) || array_filter($ids, fn (mixed $id) => ! is_string($id) || ! Str::isUlid($id)) !== []) {
            $fail('label_ids', __('field.label_ids.unknown'));

            return [];
        }

        $ids = array_values(array_unique(array_map(strtolower(...), $ids)));
        if (Label::query()->whereKey($ids)->count() !== count($ids)) {
            $fail('label_ids', __('field.label_ids.unknown'));
        }

        return $ids;
    }

    /**
     * @param  array<array-key, mixed>  $input
     * @param  callable(string, string): void  $fail
     */
    private static function day(array $input, string $field, callable $fail): ?string
    {
        $day = $input[$field] ?? null;
        if ($day === null) {
            return null;
        }
        if (! is_string($day) || ! DateRange::isDay($day)) {
            $fail($field, __('field.date.invalid'));

            return null;
        }

        return $day;
    }

    /**
     * @param  callable(string, string): void  $fail
     */
    private static function assignee(mixed $id, Project $project, callable $fail): ?string
    {
        if ($id === null) {
            return null;
        }

        $user = is_string($id) && Str::isUlid($id) ? User::query()->find(strtolower($id)) : null;
        if ($user === null || ! Assignable::check($user, $project)) {
            $fail('assignee_id', __('field.assignee_id.invalid'));

            return null;
        }

        return $user->id;
    }

    /**
     * The parent by ULID or key (`WEB-12`, any case, also a former identifier), with its type. An item of a project the
     * reader does not see is unknown, never "in another project". One of the project is read again under a shared lock
     * (after the locks of the caller: the project, the item itself): a change of its type or its deletion waits until
     * the caller is done, and the caller sees the parent as such a change left it (gone meanwhile: unknown).
     *
     * @param  callable(string, string): void  $fail
     */
    private static function parent(mixed $ref, Project $project, User $reader, callable $fail): ?WorkItem
    {
        if ($ref === null) {
            return null;
        }

        $parent = is_string($ref) ? WorkItem::findByReference($ref) : null;
        if ($parent?->project_id === $project->id) {
            $parent = WorkItem::query()->sharedLock()->find($parent->id);
        }
        if ($parent === null || ($parent->project_id !== $project->id && Visibility::roleIn($reader, $parent->project) === null)) {
            $fail('parent_id', __('field.parent_id.unknown'));
        } elseif ($parent->project_id !== $project->id) {
            $fail('parent_id', __('field.parent_id.project'));
        } else {
            return $parent->load('type');
        }

        return null;
    }

    /**
     * The `values` of an input: a map (an empty list is an empty map), anything else is `field.values.invalid`.
     *
     * @param  callable(string, string): void  $fail
     * @return array<array-key, mixed>
     */
    public static function values(mixed $values, callable $fail): array
    {
        if (! is_array($values) || ($values !== [] && array_is_list($values))) {
            $fail('values', __('field.values.invalid'));

            return [];
        }

        return $values;
    }
}
