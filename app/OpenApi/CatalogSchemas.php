<?php

namespace App\OpenApi;

use App\Access\ProjectRole;
use App\Domain\Automations\AutomationKey;
use App\Domain\Catalog\Tone;
use App\Domain\Catalog\TypeIcon;
use App\Domain\Properties\FieldType;
use App\Domain\Workflow\StateCategory;
use App\Domain\Workflow\StateIcon;
use App\Enums\ProjectVisibility;
use App\Support\CatalogInput;
use App\Support\ProjectInput;
use App\Support\PropertyInput;
use App\Support\WorkflowInput;

/**
 * The hand-written bodies and answers of the project side and of the catalogs (`#[Body]`, `#[Answer]`): projects, their
 * members, favorites, automations, workflows, types, properties, labels, relation types and resolutions. Plain JSON
 * Schema (OpenAPI 3.1). The catalogs replace an entry as a whole (`PUT`, A59/A75): the body of a save names every
 * key the action reads, the ones it needs as `required`, and takes the keys of its own answer as `readOnly` (sent back,
 * ignored), so the body is open (`x-werkbuch-open`, K2). `CatalogDocsTest` holds the keys against the `FIELDS` of the
 * actions.
 */
final class CatalogSchemas
{
    private const ULID = PathParameters::ULID;

    /**
     * @param  string|list<string>  $type
     * @return array<string, mixed>
     */
    private static function echoed(string|array $type, string $what = 'the answer'): array
    {
        return ['type' => $type, 'readOnly' => true, 'description' => "Part of {$what}; sent back, ignored."];
    }

    /** @return array<string, mixed> */
    private static function ulid(string $description, bool $nullable = false): array
    {
        return ['type' => $nullable ? ['string', 'null'] : 'string', 'pattern' => self::ULID, 'description' => $description];
    }

    /**
     * A map from a key to a text. An empty map may also come as an empty list `[]` (PHP clients write it so).
     *
     * @return array<string, mixed>
     */
    private static function map(string $description, ?string $pattern = null): array
    {
        return [
            'type' => ['object', 'array', 'null'],
            'description' => $description,
            'maxItems' => 0,
            'additionalProperties' => array_filter(['type' => 'string', 'pattern' => $pattern]),
        ];
    }

    /** @return array<string, mixed> */
    private static function name(string $what = 'name'): array
    {
        return ['type' => 'string', 'minLength' => 1, 'maxLength' => CatalogInput::NAME_MAX, 'description' => "The {$what}, unique among its kind (case and accents do not count)."];
    }

    /** @return array<string, mixed> */
    private static function tone(string $what): array
    {
        return ['type' => 'string', 'enum' => array_column(Tone::cases(), 'value'), 'description' => "The colour of the {$what}."];
    }

    /** @return array<string, mixed> */
    private static function archivedAt(string $what): array
    {
        return [
            'type' => ['string', 'null'],
            'description' => "A text archives the {$what} (the server sets the time; an archived one keeps its time), `null` or leaving it out keeps it active.",
        ];
    }

    /**
     * @param  array<string, array<string, mixed>>  $properties
     * @param  list<string>  $required
     * @return array<string, mixed>
     */
    private static function object(string $description, array $properties, array $required = [], bool $open = false): array
    {
        return array_filter([
            'type' => 'object',
            'description' => $description,
            'x-werkbuch-open' => $open ?: null,
            'properties' => $properties,
            'required' => $required ?: null,
        ], fn (mixed $value) => $value !== null);
    }

    /**
     * `POST /projects`.
     *
     * @return array<string, mixed>
     */
    public static function projectCreate(): array
    {
        return self::object(
            'A new project. The account that creates it becomes its admin; the lead becomes a member.',
            self::projectFields(true),
            ['name', 'identifier'],
            true,
        );
    }

    /**
     * `PATCH /projects/{project}`.
     *
     * @return array<string, mixed>
     */
    public static function projectUpdate(): array
    {
        return self::object(
            'Only the keys that are named change; the answer of the project may come back as it is. '
            .'`workflow_id` of the project itself passes, another one is 422 (`PUT /projects/{project}/workflow` switches it).',
            self::projectFields(false),
            [],
            true,
        );
    }

    /**
     * @param  bool  $create  on create `null` means "not given" for lead, workflow and types; a change never clears them
     * @return array<string, array<string, mixed>>
     */
    private static function projectFields(bool $create): array
    {
        return [
            'id' => self::echoed('string'),
            'archived_at' => self::echoed(['string', 'null']),
            'my_role' => self::echoed(['string', 'null']),
            'is_member' => self::echoed('boolean'),
            'members' => self::echoed('array', 'the answer with `include=members`'),
            'name' => ['type' => 'string', 'minLength' => 1, 'maxLength' => ProjectInput::NAME_MAX],
            'identifier' => [
                'type' => 'string', 'maxLength' => 64,
                'description' => '2 to 10 letters or digits, the first a letter (trimmed, stored in upper case); unique, also against former identifiers. A changed identifier keeps the old one as a former identifier that still resolves.',
            ],
            'description' => ['type' => ['string', 'null'], 'maxLength' => ProjectInput::DESCRIPTION_MAX],
            'image_url' => [
                'type' => ['string', 'null'], 'format' => 'uri',
                'description' => 'The project picture: a data URL (`data:image/png;base64,…`; PNG, JPEG, WebP or GIF, never SVG; at most 2 MB and 4096 px per side) replaces it, `null` removes it, the address that came back leaves it as it is.',
            ],
            'visibility' => ['type' => 'string', 'enum' => array_column(ProjectVisibility::cases(), 'value'), 'description' => 'Who sees the project: everybody (`public`) or its members and the org admins (`private`). Public by default.'],
            'lead_id' => self::ulid('The lead: an active person (not a bot). On create the account that creates the project by default (`null` or left out); on update a member of the project.', $create),
            'workflow_id' => self::ulid('The workflow. On create the default workflow by default (`null` or left out); on update only the project\'s own passes.', $create),
            'enabled_type_ids' => [
                'type' => $create ? ['array', 'null'] : 'array', 'minItems' => 1, 'uniqueItems' => true, 'items' => ['type' => 'string', 'pattern' => self::ULID],
                'description' => 'The switched-on work item types. On create every active type by default (`null` or left out); a newly switched-on one must be active.',
            ],
            'default_type_id' => self::ulid('The type new items get: one of the switched-on active types. On create the first of them by default (`null` or left out).', $create),
        ];
    }

    /**
     * `PUT /projects/{project}/workflow`.
     *
     * @return array<string, mixed>
     */
    public static function projectWorkflow(): array
    {
        return self::object(
            'Switches the workflow of the project. Every state of the old workflow that holds items of the project (archived ones too) needs a new state in `mapping`; '
            .'without one the answer is 422 at `mapping.<state_id>` with `states` (state, name, items) naming the missing ones. The same workflow again changes nothing.',
            [
                'workflow_id' => self::ulid('The new workflow.'),
                'mapping' => self::map('Old state (ULID) to the state of the new workflow (ULID) that takes over its items. States without items need none.', self::ULID),
            ],
            ['workflow_id'],
            true,
        );
    }

    /**
     * `POST /projects/{project}/members`.
     *
     * @return array<string, mixed>
     */
    public static function memberAdd(): array
    {
        return self::object(
            'Adds an account (person or bot, active) to the project.',
            [
                'project_id' => self::echoed('string'),
                'user_id' => self::ulid('The account to add.'),
                'role' => self::projectRole(),
            ],
            ['user_id', 'role'],
            true,
        );
    }

    /**
     * `PATCH /projects/{project}/members/{user}`.
     *
     * @return array<string, mixed>
     */
    public static function memberRole(): array
    {
        return self::object(
            'The new role of a member.',
            [
                'project_id' => self::echoed('string'),
                'user_id' => self::echoed('string'),
                'role' => self::projectRole(),
            ],
            ['role'],
            true,
        );
    }

    /** @return array<string, mixed> */
    private static function projectRole(): array
    {
        return ['type' => 'string', 'enum' => array_column(ProjectRole::cases(), 'value'), 'description' => 'The role in the project.'];
    }

    /**
     * `POST /favorites/toggle`.
     *
     * @return array<string, mixed>
     */
    public static function favoriteToggle(): array
    {
        return self::object(
            'Puts a project or a view into the favorites of the account, or takes it out when it is in already.',
            [
                'kind' => ['type' => 'string', 'enum' => ['project', 'view'], 'description' => 'What is toggled.'],
                'id' => ['type' => 'string', 'description' => 'The ULID of the project or of the view (an identifier is 404).'],
            ],
            ['kind', 'id'],
            true,
        );
    }

    /**
     * The answer of `POST /favorites/toggle`.
     *
     * @return array<string, mixed>
     */
    public static function favoriteToggled(): array
    {
        return self::object(
            'The new state; it is no resource, so there is no `data`.',
            [
                'kind' => ['type' => 'string', 'enum' => ['project', 'view']],
                'id' => ['type' => 'string', 'pattern' => self::ULID, 'description' => 'The ULID of the project or view.'],
                'favorite' => ['type' => 'boolean', 'description' => 'Whether it is a favorite now.'],
            ],
            ['kind', 'id', 'favorite'],
        );
    }

    /**
     * The settings of an automation (the answer and the body): the keys of the automation count, others are ignored.
     *
     * @return array<string, mixed>
     */
    public static function automationSettings(): array
    {
        return self::object(
            'The settings of the automation. Only its own keys count (others are ignored), a key left out keeps what is stored: '
            .'`days` for the nightly automations (`'.AutomationKey::AutoArchive->value.'`, `'.AutomationKey::AutoClose->value.'`), `state_id` for `'.AutomationKey::AutoClose->value.'`. '
            .'`'.AutomationKey::CloseParent->value.'`, `'.AutomationKey::AssignOnStart->value.'` and `'.AutomationKey::LinkReferences->value.'` have none.',
            [
                'days' => ['type' => 'integer', 'minimum' => AutomationKey::MIN_DAYS, 'maximum' => AutomationKey::MAX_DAYS, 'description' => 'How many days a nightly automation waits.'],
                'state_id' => self::ulid('Auto-Close: the Canceled state of the project\'s workflow the items move to; required to switch it on, `null` takes it away.', true),
            ],
            [],
            true,
        );
    }

    /**
     * `PUT /projects/{project}/automations/{key}`.
     *
     * @return array<string, mixed>
     */
    public static function automation(): array
    {
        return self::object(
            'Switches an automation on or off and sets its settings. Nothing changed writes nothing.',
            [
                'id' => self::echoed(['string', 'null']),
                'project_id' => self::echoed('string'),
                'key' => self::echoed('string'),
                'enabled' => ['type' => 'boolean', 'description' => 'Whether the automation runs. Without a stored row, the default of the key: on for `'.AutomationKey::LinkReferences->value.'`, off for the others.'],
                'settings' => self::automationSettings(),
            ],
            ['enabled'],
            true,
        );
    }

    /**
     * `POST /workflows` and `PUT /workflows/{workflow}`.
     *
     * @return array<string, mixed>
     */
    public static function workflow(): array
    {
        return self::object(
            'A workflow as a whole (a `PUT` replaces it). New states come with ids of your own (any text that does not start with `new:`); '
            .'only states of this workflow keep their ULID, any other id is a new state. Transitions between unknown states or from a state to itself fall away. '
            .'A workflow the graph refuses is 422 `invalid_workflow` with `issues`; a removed state that holds items needs a target in `state_mapping`, else 409 `state_in_use`.',
            [
                'id' => self::echoed('string'),
                'name' => self::name(),
                'description' => ['type' => ['string', 'null'], 'maxLength' => CatalogInput::DESCRIPTION_MAX],
                'is_default' => ['type' => 'boolean', 'description' => 'The one default workflow; a new default takes the mark from the old one, the default cannot be switched off.'],
                'is_free' => ['type' => 'boolean', 'description' => 'Every move between states is allowed; `transitions` then only shapes the board.'],
                'initial_state_id' => ['type' => 'string', 'description' => 'The state new items start in: the id of one of `states`.'],
                'states' => [
                    'type' => 'array', 'minItems' => 1, 'maxItems' => WorkflowInput::STATES_MAX,
                    'items' => self::object('A state.', [
                        'id' => ['type' => ['string', 'null'], 'maxLength' => 64, 'description' => 'The ULID of a state of this workflow, or an id of your own for a new one.'],
                        'name' => ['type' => 'string', 'minLength' => 1, 'maxLength' => WorkflowInput::STATE_NAME_MAX],
                        'icon' => ['type' => 'string', 'enum' => array_column(StateIcon::cases(), 'value')],
                        'category' => ['type' => 'string', 'enum' => array_column(StateCategory::cases(), 'value'), 'description' => 'What the state means: items in a Completed or Canceled state are closed.'],
                        'position' => self::echoed('integer'),
                    ], ['name', 'icon', 'category'], true),
                ],
                'transitions' => [
                    'type' => 'array',
                    'description' => 'The allowed moves as pairs `[from, to]` of state ids.',
                    'items' => ['type' => 'array', 'minItems' => 2, 'maxItems' => 2, 'items' => ['type' => 'string']],
                ],
                'state_mapping' => self::map('Removed state (ULID) to the state (an id of `states`) that takes over its items; only for a `PUT`.'),
            ],
            ['name', 'is_default', 'is_free', 'initial_state_id', 'states', 'transitions'],
            true,
        );
    }

    /**
     * `POST /work-item-types` and `PUT /work-item-types/{workItemType}`.
     *
     * @return array<string, mixed>
     */
    public static function workItemType(): array
    {
        return self::object(
            'A work item type as a whole (a `PUT` replaces it).',
            [
                'id' => self::echoed('string'),
                'name' => self::name(),
                'icon' => ['type' => 'string', 'enum' => TypeIcon::NAMES],
                'tone' => self::tone('type'),
                'description' => ['type' => ['string', 'null'], 'maxLength' => CatalogInput::DESCRIPTION_MAX],
                'is_epic' => ['type' => 'boolean', 'description' => 'An epic can have child items and no parent; it shows in the timeline. Switching it off needs an epic without children, on a type without parents.'],
                'properties' => [
                    'type' => 'array',
                    'description' => 'The properties the type asks for, in order.',
                    'items' => self::object('A property of the type.', [
                        'property_id' => self::ulid('The property.'),
                        'required' => ['type' => 'boolean', 'description' => 'Whether an item of the type must have a value.'],
                        'position' => self::echoed('integer'),
                    ], ['property_id', 'required'], true),
                ],
                'archived_at' => self::archivedAt('type'),
            ],
            ['name', 'icon', 'tone', 'is_epic', 'properties'],
            true,
        );
    }

    /**
     * `POST /properties` and `PUT /properties/{property}`.
     *
     * @return array<string, mixed>
     */
    public static function property(): array
    {
        return self::object(
            'A property as a whole (a `PUT` replaces it). `key` and `field_type` stay as they are; a single choice may become a multiple one, not back.',
            [
                'id' => self::echoed('string'),
                'key' => ['type' => 'string', 'maxLength' => 40, 'description' => 'snake_case, at most 40 characters, not the name of a core field of an item; unique. Part of `values` of an item.'],
                'label' => ['type' => 'string', 'minLength' => 1, 'maxLength' => PropertyInput::LABEL_MAX],
                'field_type' => ['type' => 'string', 'enum' => array_column(FieldType::cases(), 'value')],
                'help' => ['type' => ['string', 'null'], 'maxLength' => CatalogInput::HELP_MAX],
                'default_value' => self::defaultValue(),
                'settings' => [...self::propertySettings(), 'type' => ['object', 'array', 'null'], 'maxItems' => 0],
                'options' => [
                    'type' => ['array', 'null'],
                    'description' => 'The options of a dropdown (at least one that is not archived); every other field type has none.',
                    'maxItems' => PropertyInput::OPTIONS_MAX,
                    'items' => self::object('An option.', [
                        'id' => ['type' => ['string', 'null'], 'maxLength' => 64, 'description' => 'The ULID of an option of this property, or an id of your own for a new one. An option you leave out is removed, or archived when items carry it.'],
                        'label' => ['type' => 'string', 'minLength' => 1, 'maxLength' => PropertyInput::OPTION_LABEL_MAX],
                        'color' => self::tone('option'),
                        'archived_at' => self::archivedAt('option'),
                        'position' => self::echoed('integer'),
                    ], ['label', 'color'], true),
                ],
            ],
            ['key', 'label', 'field_type'],
            true,
        );
    }

    /**
     * The settings of a property (the answer and the body).
     *
     * @return array<string, mixed>
     */
    public static function propertySettings(): array
    {
        return self::object(
            'The settings of the field type: `decimals` for a number, `multiple` for a dropdown and a choice of people; every other type has none (`{}`).',
            [
                'decimals' => ['type' => 'integer', 'minimum' => 0, 'maximum' => PropertyInput::DECIMALS_MAX, 'description' => 'The decimals a number keeps.'],
                'multiple' => ['type' => 'boolean', 'description' => 'Whether several values can be chosen.'],
            ],
            [],
            true,
        );
    }

    /**
     * The default value of a property: what an item gets when it is created without a value.
     *
     * @return array<string, mixed>
     */
    public static function defaultValue(): array
    {
        return [
            'description' => 'The value new items start with, in the form of the field type (a text, a number, `true`/`false`, a day `YYYY-MM-DD`, an option id, a list of option ids for a multiple dropdown); `null` for none. Checked like the value of an item.',
            'anyOf' => [
                ['type' => 'string'], ['type' => 'number'], ['type' => 'boolean'], ['type' => 'null'],
                ['type' => 'array', 'items' => ['type' => 'string']],
            ],
        ];
    }

    /**
     * `POST /labels` and `PUT /labels/{label}`.
     *
     * @return array<string, mixed>
     */
    public static function label(): array
    {
        return self::object('A label as a whole (a `PUT` replaces it).', [
            'id' => self::echoed('string'),
            'name' => self::name(),
            'color' => self::tone('label'),
        ], ['name', 'color'], true);
    }

    /**
     * `POST /relation-types` and `PUT /relation-types/{relationType}`.
     *
     * @return array<string, mixed>
     */
    public static function relationType(): array
    {
        return self::object('A relation type as a whole (a `PUT` replaces it).', [
            'id' => self::echoed('string'),
            'built_in' => self::echoed(['string', 'null'], 'the answer: the built-in kind (`blocks`, `duplicates`, `relates`) or `null`'),
            'name' => self::name(),
            'outward_label' => ['type' => 'string', 'minLength' => 1, 'maxLength' => 60, 'description' => 'How the source reads the relation (“blocks”).'],
            'inward_label' => ['type' => ['string', 'null'], 'maxLength' => 60, 'description' => 'How the target reads it (“is blocked by”); `null` or left out makes the type symmetric.'],
        ], ['name', 'outward_label'], true);
    }

    /**
     * `POST /resolutions` and `PUT /resolutions/{resolution}`.
     *
     * @return array<string, mixed>
     */
    public static function resolution(): array
    {
        return self::object('A resolution as a whole (a `PUT` replaces it). Every closed category has exactly one default.', [
            'id' => self::echoed('string'),
            'position' => self::echoed('integer'),
            'label' => self::name('label'),
            'default_for' => [
                'type' => ['string', 'null'], 'enum' => [StateCategory::Completed->value, StateCategory::Canceled->value, null],
                'description' => 'The category the resolution is the default for. A new default takes the mark from the old one; the last default of a category cannot lose it (422).',
            ],
            'archived_at' => self::archivedAt('resolution'),
        ], ['label'], true);
    }

    /**
     * The answer of `DELETE /work-item-types/{workItemType}` and `DELETE /resolutions/{resolution}`.
     *
     * @return array<string, mixed>
     */
    public static function deleteOutcome(): array
    {
        return self::object('What became of the entry; there is no `data`.', [
            'outcome' => ['type' => 'string', 'enum' => ['deleted', 'archived'], 'description' => '`archived` when items still carry the entry: it stays, archived (no new items get it).'],
        ], ['outcome']);
    }

    /**
     * The answer of `DELETE /properties/{property}` and `DELETE /labels/{label}`.
     *
     * @return array<string, mixed>
     */
    public static function affectedItems(): array
    {
        return self::object('How many items lost the entry; there is no `data`.', [
            'affected_items' => ['type' => 'integer', 'minimum' => 0, 'description' => 'The items that had a value of the property (or the label). The history keeps the values.'],
        ], ['affected_items']);
    }

    /**
     * The answer of `DELETE /relation-types/{relationType}`.
     *
     * @return array<string, mixed>
     */
    public static function affectedRelations(): array
    {
        return self::object('How many relations went with the type; there is no `data`.', [
            'affected_relations' => ['type' => 'integer', 'minimum' => 0],
        ], ['affected_relations']);
    }

    /**
     * The answer of `GET /state-usage`.
     *
     * @return array<string, mixed>
     */
    public static function stateUsage(): array
    {
        return self::object('The items per state; states without items are left out.', [
            'data' => [
                'type' => 'array',
                'items' => self::object('One state.', [
                    'state_id' => ['type' => 'string', 'pattern' => self::ULID],
                    'items' => ['type' => 'integer', 'minimum' => 1, 'description' => 'The items in the state, archived ones included.'],
                ], ['state_id', 'items']),
            ],
        ], ['data']);
    }
}
