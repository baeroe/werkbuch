<?php

namespace App\Support;

use App\Access\Assignable;
use App\Access\Visibility;
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
use App\RichText\MarkdownContext;
use App\RichText\RichTextInput;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * The fields of a work item as the actions that write them check them (spec 4.4, the checks of `itemRules.ts`), with
 * their field messages (P9). Every field error of one input comes in one ValidationException, the values of the
 * properties (ItemValues) included. Callers read the rich text with documents() before their locks and check the rest
 * with create() under them.
 */
final class ItemInput
{
    public const TITLE_MAX = 255;

    /**
     * The input with its rich text read, before any lock: `description` (or `description_json`) becomes a Document or
     * `null` under `description`, the rich text values become Documents (ItemValues::documents()). What cannot be read
     * comes back as field errors, for create() to report with all the others.
     *
     * @param  array<array-key, mixed>  $input
     * @return array{0: array<array-key, mixed>, 1: array<string, list<string>>}
     */
    public static function documents(array $input, Project $project): array
    {
        $ctx = new MarkdownContext($project);
        $errors = [];

        if (RichTextInput::given($input, 'description')) {
            try {
                $description = RichTextInput::from($input, 'description', $ctx);
            } catch (ValidationException $invalid) {
                $description = null;
                $errors = $invalid->errors();
            }
            unset($input['description_json']);
            $input['description'] = $description;
        }

        if (is_array($input['values'] ?? null)) {
            [$input['values'], $refused] = ItemValues::documents($input['values'], $ctx);
            $errors = [...$errors, ...$refused];
        }

        return [$input, $errors];
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
     * @param  callable(string, string): void  $fail
     */
    private static function type(mixed $id, Project $project, callable $fail): ?WorkItemType
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
     * reader does not see is unknown, never "in another project".
     *
     * @param  callable(string, string): void  $fail
     */
    private static function parent(mixed $ref, Project $project, User $reader, callable $fail): ?WorkItem
    {
        if ($ref === null) {
            return null;
        }

        $parent = is_string($ref) ? WorkItem::findByReference($ref) : null;
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
     * @param  callable(string, string): void  $fail
     * @return array<array-key, mixed>
     */
    private static function values(mixed $values, callable $fail): array
    {
        if (! is_array($values) || ($values !== [] && array_is_list($values))) {
            $fail('values', __('field.values.invalid'));

            return [];
        }

        return $values;
    }
}
