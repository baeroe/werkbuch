<?php

namespace App\OpenApi;

use App\Actions\WorkItems\BulkUpdateWorkItems;
use App\Actions\WorkItems\GetWorkItem;
use App\Domain\Views\GroupBy;
use App\Domain\Workflow\StateCategory;
use App\Domain\WorkItems\Priority;
use App\Support\Actor;
use App\Support\ItemInput;

/**
 * The hand-written bodies and answers of the work items (`#[Body]`, `#[Answer]`) and the parts of their resources
 * Scramble cannot read (`Components`): an item, its changes, the bulk edit, a relation and the history. Plain JSON
 * Schema (OpenAPI 3.1). A body is open (`x-werkbuch-open`) where the action passes over keys it does not know (creating
 * and changing an item, a move, a new type, a relation, K2) and closed where it refuses them (the patch of the bulk
 * edit, `field.patch.invalid`). On create `null` means "not given" (the default); on a change it clears what can be
 * empty. `WorkItemsDocsTest` holds the keys against the `FIELDS` of the actions.
 */
final class WorkItemSchemas
{
    private const ULID = PathParameters::ULID;

    /**
     * A `$ref` to a component (a method with an argument: opcache inlines one that returns a constant array, and the
     * coverage never sees its line).
     *
     * @return array<string, string>
     */
    private static function ref(string $component): array
    {
        return ['$ref' => "#/components/schemas/{$component}"];
    }

    /** @return array<string, mixed> */
    private static function ulid(string $description, bool $nullable = false): array
    {
        return ['type' => $nullable ? ['string', 'null'] : 'string', 'pattern' => self::ULID, 'description' => $description];
    }

    /** @return array<string, mixed> */
    private static function day(string $description, bool $nullable = true): array
    {
        return ['type' => $nullable ? ['string', 'null'] : 'string', 'format' => 'date', 'description' => $description];
    }

    /** @return array<string, mixed> */
    private static function priority(string $description, bool $nullable): array
    {
        $enum = array_column(Priority::cases(), 'value');

        return ['type' => $nullable ? ['string', 'null'] : 'string', 'enum' => $nullable ? [...$enum, null] : $enum, 'description' => $description];
    }

    /** @return array<string, mixed> */
    private static function labels(string $description): array
    {
        return ['type' => ['array', 'null'], 'items' => ['type' => 'string', 'pattern' => self::ULID], 'description' => $description];
    }

    /**
     * The values of the properties a body sends, property key → value. An empty map may also come as `[]`.
     *
     * @return array<string, mixed>
     */
    private static function values(string $description, bool $nullable): array
    {
        return [
            'type' => $nullable ? ['object', 'array', 'null'] : ['object', 'array'],
            'maxItems' => 0,
            'description' => $description.' A value by the field type of the property: a text, a number, `true`/`false`, a day `YYYY-MM-DD`, '
                .'an address, the ULID of an option or an account (a list of them for a multiple choice), rich text as Markdown or Tiptap JSON. '
                .'`null` or an empty value removes it (a required property cannot be emptied).',
            'additionalProperties' => ['anyOf' => [
                ['type' => ['string', 'number', 'boolean', 'null']],
                ['type' => 'array', 'items' => ['type' => 'string']],
                self::ref('RichTextDocument'),
            ]],
        ];
    }

    /** @return array<string, array<string, mixed>> */
    private static function texts(): array
    {
        return [
            'description' => ['type' => ['string', 'null'], 'description' => 'The description as Markdown (`@handle` mentions, `WEB-12` references). Send it or `description_json`, not both; `null` is none.'],
            'description_json' => ['anyOf' => [self::ref('RichTextDocument'), ['type' => 'null']], 'description' => 'The description as Tiptap JSON.'],
        ];
    }

    /**
     * @param  array<string, array<string, mixed>>  $properties
     * @param  list<string>  $required
     * @return array<string, mixed>
     */
    private static function object(string $description, array $properties, array $required = [], bool $open = true): array
    {
        return array_filter([
            'type' => 'object',
            'description' => $description,
            'x-werkbuch-open' => $open ?: null,
            'properties' => $properties,
            'required' => $required ?: null,
        ], fn (mixed $value) => $value !== null && $value !== '');
    }

    /**
     * `POST /work-items`.
     *
     * @return array<string, mixed>
     */
    public static function create(): array
    {
        return self::object(
            'A new work item in a project (every member with `item.create`). Keys left out or `null` take their default. '
                .'Every field error comes in one 422; a required property without a value is 422 at `values.<key>`.',
            [
                'project_id' => ['type' => 'string', 'description' => 'The project: its ULID, identifier or a former identifier.'],
                'type_id' => self::ulid('The type: switched on in the project and active. By default the default type of the project.', true),
                'title' => ['type' => 'string', 'minLength' => 1, 'maxLength' => ItemInput::TITLE_MAX, 'description' => 'Trimmed.'],
                ...self::texts(),
                'priority' => self::priority('By default `none`.', true),
                'label_ids' => self::labels('Existing labels, each once.'),
                'start_date' => self::day('The start day, not after the due date.'),
                'due_date' => self::day('The due day.'),
                'assignee_id' => self::ulid('Who works on it: an active member of the project (or an org admin person).', true),
                'parent_id' => ['type' => ['string', 'null'], 'description' => 'The epic of the same project it belongs to: ULID or key. An epic has no parent (two levels).'],
                'values' => self::values('The values of the properties of the type, property key → value; a property left out takes its default.', true),
                'state_id' => self::ulid('The state it starts in: by default the initial state of the workflow; another one is a move from there (409 `transition_not_allowed` when the workflow forbids it).', true),
                'template_id' => self::ulid('A template of the project the item is made from. It fills no field (the title stays required): the server only copies the images of its texts, and the item keeps the template and the event names it.', true),
            ],
            ['project_id', 'title'],
        );
    }

    /**
     * `PATCH /work-items/{item}`.
     *
     * @return array<string, mixed>
     */
    public static function update(): array
    {
        return self::object(
            'Only the keys that are sent change; `null` clears what can be empty. With `base_description_version` a description '
                .'saved by someone else meanwhile is 409 `description_conflict` with `current` (the item as it is now); without it the last one wins. '
                .'`state_id` and `resolution_id` are a move like `POST /work-items/{item}/transition`. An archived item is read-only (409 `archived`).',
            [
                'title' => ['type' => 'string', 'minLength' => 1, 'maxLength' => ItemInput::TITLE_MAX, 'description' => 'Trimmed.'],
                ...self::texts(),
                'base_description_version' => ['type' => ['integer', 'null'], 'minimum' => 1, 'description' => 'The `description_version` the new description was written on.'],
                'priority' => self::priority('The priority (`none` for none).', false),
                'label_ids' => self::labels('All labels of the item (replaces them); `null` removes all.'),
                'start_date' => self::day('The start day, not after the due date.'),
                'due_date' => self::day('The due day.'),
                'assignee_id' => self::ulid('Who works on it; `null` nobody.', true),
                'parent_id' => ['type' => ['string', 'null'], 'description' => 'The epic it belongs to (ULID or key); `null` none.'],
                'values' => self::values('Only the properties sent change.', false),
                'rank' => ['type' => 'string', 'maxLength' => ItemInput::RANK_MAX, 'description' => 'The place in the manual order (a fractional index, compared byte by byte).'],
                'state_id' => self::ulid('A state of the workflow of the project.'),
                'resolution_id' => self::ulid('For a closed state: the resolution (`null` is none chosen: the one it has or the default).', true),
            ],
        );
    }

    /**
     * `POST /work-items/{item}/transition`.
     *
     * @return array<string, mixed>
     */
    public static function transition(): array
    {
        return self::object(
            'Moves the item to a state of its workflow. A state outside the workflow is 422 at `state_id`; a move the workflow '
                .'forbids is 409 `transition_not_allowed`.',
            [
                'to_state_id' => self::ulid('The new state.'),
                'resolution_id' => self::ulid('For a closed state (completed, canceled): the resolution; `null` keeps the one of the same category or takes the default.', true),
            ],
            ['to_state_id'],
        );
    }

    /**
     * `PUT /work-items/{item}/type`.
     *
     * @return array<string, mixed>
     */
    public static function changeType(): array
    {
        return self::object(
            'Changes the type. Values of properties the new type does not have go; the required ones of the new type come in `values`. '
                .'An item with children stays an epic, an item with a parent cannot become one (422 at `type_id`).',
            [
                'type_id' => self::ulid('The new type: switched on in the project and active.'),
                'values' => self::values('Values for the properties of the new type.', true),
            ],
            ['type_id'],
        );
    }

    /**
     * `POST /work-items/{item}/relations`.
     *
     * @return array<string, mixed>
     */
    public static function relation(): array
    {
        return self::object(
            'A relation from this item (its source) to another one the account sees, in any project.',
            [
                'type_id' => self::ulid('The relation type.'),
                'target_id' => ['type' => 'string', 'description' => 'The other item: ULID or key. An item the account does not see is the same 422 as an unknown one.'],
            ],
            ['type_id', 'target_id'],
        );
    }

    /**
     * `POST /work-items/bulk`.
     *
     * @return array<string, mixed>
     */
    public static function bulk(): array
    {
        $id = fn (string $description): array => self::ulid($description, true);

        return self::object(
            'One patch for up to '.BulkUpdateWorkItems::MAX_IDS.' items. The form of the patch is checked once (a wrong one is 422 '
                .'at `patch.<field>` and changes nothing); then every item on its own: a refused item is a line of `rejected`, the others change.',
            [
                'ids' => [
                    'type' => 'array', 'minItems' => 1, 'maxItems' => BulkUpdateWorkItems::MAX_IDS, 'items' => ['type' => 'string'],
                    'description' => 'The items: ULIDs or keys, the same item twice counts once.',
                ],
                'patch' => [
                    'type' => 'object',
                    'description' => 'What changes, at least one key; any other key is 422 `field.patch.invalid` (no rich text).',
                    'minProperties' => 1,
                    'additionalProperties' => false,
                    'properties' => [
                        'state_id' => $id('A state of the workflow of each item.'),
                        'resolution_id' => $id('For a closed state: the resolution.'),
                        'assignee_id' => $id('Who works on them; `null` nobody.'),
                        'priority' => self::priority('The priority.', false),
                        'label_ids' => self::labels('All labels (replaces them).'),
                        'add_label_ids' => self::labels('Labels to add (existing ones).'),
                        'remove_label_ids' => self::labels('Labels to remove.'),
                        'start_date' => self::day('The start day.'),
                        'due_date' => self::day('The due day.'),
                        'archived' => ['type' => 'boolean', 'description' => '`true` archives after the patch (only closed items), `false` restores before it.'],
                    ],
                ],
            ],
            ['ids', 'patch'],
        );
    }

    /**
     * The answer of `POST /projects/{project}/redistribute-ranks`.
     *
     * @return array<string, mixed>
     */
    public static function redistributed(): array
    {
        return self::object('How many items of the project got a new rank.', [
            'redistributed' => ['type' => 'integer', 'minimum' => 0, 'description' => 'The items whose rank changed; 0 when every rank was short already.'],
        ], ['redistributed'], false);
    }

    /**
     * The answer of `POST /work-items/bulk`.
     *
     * @return array<string, mixed>
     */
    public static function bulkDone(): array
    {
        return self::object('Which items took the patch and which refused it.', [
            'updated' => ['type' => 'array', 'items' => ['type' => 'string'], 'description' => 'The ULIDs of the items that were not refused (changed or already so).'],
            'rejected' => [
                'type' => 'array',
                'description' => 'Each refused item by the reference sent, with the reason of its problem (`validation_failed` for field errors).',
                'items' => [
                    'type' => 'object',
                    'properties' => ['id' => ['type' => 'string'], 'reason' => ['type' => 'string', 'examples' => ['not_found', 'forbidden', 'archived', 'not_closed', 'validation_failed']]],
                    'required' => ['id', 'reason'],
                ],
            ],
        ], ['updated', 'rejected'], false);
    }

    /**
     * The answer of `POST /work-items/groups`.
     *
     * @return array<string, mixed>
     */
    public static function groups(): array
    {
        $item = self::object('The parent item of a group by `parent` (`null` for `none` and for a parent the account does not see).', [
            'id' => ['type' => 'string'], 'key' => ['type' => 'string'], 'title' => ['type' => 'string'], 'type_id' => ['type' => 'string'],
        ], ['id', 'key', 'title', 'type_id'], false);
        $item['type'] = ['object', 'null'];

        return self::object('The groups of the query.', ['data' => self::object('', [
            'group_by' => [
                'type' => 'string', 'enum' => array_column(GroupBy::cases(), 'value'),
                'description' => 'The grouping that applies: `state` becomes `category` when the items have more than one workflow. Ask the pages of a group with this one.',
            ],
            'total' => ['type' => 'integer', 'minimum' => 0, 'description' => 'Every item once.'],
            'groups' => [
                'type' => 'array',
                'description' => 'In the order of the grouping; `none` stands for items without a value, `all` for no grouping. An item with two labels counts in both.',
                'items' => self::object('', [
                    'key' => ['type' => 'string'],
                    'count' => ['type' => 'integer', 'minimum' => 0],
                    'item' => $item,
                ], ['key', 'count'], false),
            ],
        ], ['group_by', 'total', 'groups'], false)], ['data'], false);
    }

    /**
     * The answer of `POST /work-items/counts`.
     *
     * @return array<string, mixed>
     */
    public static function counts(): array
    {
        return self::object('The numbers of the filters.', ['data' => [
            'type' => 'object',
            'description' => 'Filter name → number of items the account sees (an object, also for a name like `0`).',
            'additionalProperties' => ['type' => 'integer', 'minimum' => 0],
        ]], ['data'], false);
    }

    /**
     * The parts of `WorkItemResource` Scramble cannot read (`Components`).
     *
     * @return array<string, array<string, mixed>>
     */
    public static function itemPatches(): array
    {
        $stamp = ['type' => ['string', 'null'], 'format' => 'date-time'];

        return [
            'description_json' => ['anyOf' => [self::ref('RichTextDocument'), ['type' => 'null']], 'description' => 'The description as Tiptap JSON. Not in a lean item.'],
            'label_ids' => ['type' => 'array', 'items' => ['type' => 'string'], 'description' => 'In the order of the catalog.'],
            'start_date' => ['type' => ['string', 'null'], 'format' => 'date'],
            'due_date' => ['type' => ['string', 'null'], 'format' => 'date'],
            'values' => [
                'type' => 'object',
                'description' => 'Property key → value: a text, a number, `true`/`false`, a day, the ULID of an option or an account (a list for a multiple choice), rich text as Tiptap JSON. A property without a value is left out.',
                'additionalProperties' => ['anyOf' => [
                    ['type' => ['string', 'number', 'boolean']],
                    ['type' => 'array', 'items' => ['type' => 'string']],
                    self::ref('RichTextDocument'),
                ]],
            ],
            'values_markdown' => [
                'type' => 'object',
                'description' => 'Property key → the rich text values as Markdown for the reader. Not in a lean item.',
                'additionalProperties' => ['type' => 'string'],
            ],
            'created_at' => $stamp, 'updated_at' => $stamp, 'started_at' => $stamp, 'closed_at' => $stamp, 'archived_at' => $stamp,
            'children' => ['type' => 'array', 'items' => ['$ref' => '#/components/schemas/WorkItemResource'], 'description' => 'With `include=children`: the first '.GetWorkItem::CHILDREN_MAX.' children in manual order (archived ones included), without embeds; `children_progress.total` counts them all.'],
            'type' => ['$ref' => '#/components/schemas/WorkItemTypeResource', 'description' => 'With `include=type`.'],
            'workflow' => ['$ref' => '#/components/schemas/WorkflowResource', 'description' => 'With `include=workflow`: the workflow of the project.'],
            'relations' => ['type' => 'array', 'items' => ['$ref' => '#/components/schemas/RelationEntryResource'], 'description' => 'With `include=relations`, as the reader sees them.'],
            'attachments' => ['type' => 'array', 'items' => ['$ref' => '#/components/schemas/AttachmentResource'], 'description' => 'With `include=attachments`: the file list (not the pictures and files of the texts).'],
        ];
    }

    /**
     * One relation of an item as its reader sees it (`RelationEntryResource`, written by `RelationEntrySchema`).
     *
     * @return array<string, mixed>
     */
    public static function relationEntry(): array
    {
        return self::object(
            'A relation as this item reads it. An end the reader does not see is hidden: `other` is `null` and its id in `relation` is `""`.',
            [
                'relation' => self::object('', [
                    'id' => ['type' => 'string'],
                    'type_id' => ['type' => 'string'],
                    'source_id' => ['type' => 'string', 'description' => '`""` when the source is hidden.'],
                    'target_id' => ['type' => 'string', 'description' => '`""` when the target is hidden.'],
                ], ['id', 'type_id', 'source_id', 'target_id'], false),
                'other' => ['anyOf' => [['$ref' => '#/components/schemas/WorkItemResource'], ['type' => 'null']], 'description' => 'The item at the other end; `null` when hidden.'],
                'direction' => ['type' => 'string', 'enum' => ['outward', 'inward'], 'description' => '`outward`: this item is the source (reads the outward label); `inward`: the target.'],
                'hidden' => ['type' => 'boolean'],
            ],
            ['relation', 'other', 'direction', 'hidden'],
            false,
        );
    }

    /**
     * The parts of `HistoryEntryResource` Scramble cannot read (`Components`).
     *
     * @return array<string, array<string, mixed>>
     */
    public static function historyPatches(): array
    {
        $text = fn (string $description): array => ['type' => ['string', 'null'], 'description' => $description];
        $snapshot = self::object('', [
            'id' => ['type' => 'string'],
            'name' => ['type' => 'string'],
            'category' => ['type' => 'string', 'enum' => array_column(StateCategory::cases(), 'value')],
        ], ['id', 'name', 'category'], false);

        return [
            'changes' => [
                'type' => ['object', 'null'],
                'x-werkbuch-open' => true,
                'description' => 'Field → `{old, new}` of what changed (`title`, `state_id`, `values.<key>`, `relation`, `body` of a comment, …). '
                    .'A relation names the other end only when the reader sees it (`{label, item_id, key}`, else `{label, hidden: true}`).',
            ],
            'states' => [
                'anyOf' => [self::object('', ['old' => $snapshot, 'new' => $snapshot], ['old', 'new'], false), ['type' => 'null']],
                'description' => 'A `work_item.state_changed`: both states as they were then; `null` for other events and older ones.',
            ],
            'reason' => $text('Why it happened, when not by hand (`workflow_changed`, `parent_deleted`, `assign_on_start`, …).'),
            'via' => [
                'type' => ['string', 'null'],
                'enum' => [Actor::VIA_UI, Actor::VIA_API, Actor::VIA_MCP, Actor::VIA_AUTOMATION, Actor::VIA_TEMPLATE, Actor::VIA_SYSTEM, null],
                'description' => 'How it happened.',
            ],
            'comment_id' => $text('A `comment.updated` or `comment.deleted`: the comment.'),
            'comment_author_id' => $text('A `comment.updated` or `comment.deleted`: the author of the comment.'),
            'template' => [
                'anyOf' => [self::object('', ['id' => ['type' => 'string'], 'name' => ['type' => 'string']], ['id', 'name'], false), ['type' => 'null']],
                'description' => 'A `work_item.created` from a template: the template, with its name as it was then.',
            ],
            'occurred_at' => ['type' => 'string', 'format' => 'date-time'],
        ];
    }
}
