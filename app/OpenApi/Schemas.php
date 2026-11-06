<?php

namespace App\OpenApi;

use App\Domain\Filter\CoreField;
use App\Domain\Filter\Field;
use App\Domain\Filter\FilterSchema;
use App\Domain\Filter\Op;
use App\Domain\Views\DisplaySchema;
use App\Domain\Views\GroupBy;
use App\Domain\Views\Layout;
use App\Domain\Views\SortSpec;

/**
 * The shared schemas of the document as plain JSON Schema (OpenAPI 3.1), stored under `components.schemas` by
 * `Components`. A schema with `x-werkbuch-open` keeps keys it does not name (the extensions of a problem, the nodes of
 * a Tiptap document); every other object of an answer is closed (A385).
 */
final class Schemas
{
    /**
     * Every reason the server answers: the keys `problem.reason.*` of `lang/en.json` (the translated codes, which
     * `Problem::REASONS` mirrors).
     *
     * @return list<string>
     */
    public static function problemReasons(): array
    {
        $translations = json_decode((string) file_get_contents(base_path('lang/en.json')), true, flags: JSON_THROW_ON_ERROR);
        $reasons = [];

        foreach (array_keys($translations) as $key) {
            if (str_starts_with((string) $key, 'problem.reason.')) {
                $reasons[] = substr((string) $key, strlen('problem.reason.'));
            }
        }

        return $reasons;
    }

    /**
     * A Problem Details object (RFC 9457) as `App\Http\Api\ProblemResponse` writes it: the extensions of a `Problem`
     * (`current`, `states`, `projects`, `issues`, …) stand next to the fields.
     *
     * @return array<string, mixed>
     */
    public static function problem(): array
    {
        return [
            'type' => 'object',
            'description' => 'Problem Details (RFC 9457, `application/problem+json`). `reason` is the stable code to branch on; '
                .'some problems carry more fields next to these (`current`, `states`, `projects`, `issues`, …).',
            'properties' => [
                'type' => ['type' => 'string', 'pattern' => '^urn:werkbuch:problem:[a-z0-9_]+$', 'description' => '`urn:werkbuch:problem:<reason>`.'],
                'title' => ['type' => 'string', 'description' => 'The kind of problem, in the language of the account.'],
                'status' => ['type' => 'integer', 'minimum' => 400, 'maximum' => 599, 'description' => 'The HTTP status.'],
                'detail' => ['type' => 'string', 'description' => 'What went wrong, in the language of the account; a 404 never has one.'],
                'reason' => [
                    'type' => 'string',
                    'enum' => self::problemReasons(),
                    'description' => 'The stable code of the problem (`validation_failed`, `session_required`, …). Branch on it, not on `title` or `detail`. '
                        .'New reasons are added additively: a client treats a code it does not know like the `status` it came with.',
                ],
                'errors' => [
                    'type' => 'object',
                    'description' => 'The messages per field (`title`, `values.effort`, `filter.conditions.0.op`).',
                    'additionalProperties' => ['type' => 'array', 'items' => ['type' => 'string']],
                ],
                'current' => [
                    'description' => '`description_conflict` (409, changing the description of a work item on an old `base_description_version`): the work item as it is now; '
                        .'`page_conflict` (409, saving a wiki page on an old `base_version`): the page as it is now. Both as the account reads them.',
                    'anyOf' => [['$ref' => '#/components/schemas/WorkItemResource'], ['$ref' => '#/components/schemas/PageResource']],
                ],
                'states' => [
                    'type' => 'array',
                    'description' => '`state_in_use` (409, saving a workflow) and `validation_failed` at `mapping.<state_id>` (422, switching the workflow of a project): the states that hold items and have no target yet.',
                    'items' => [
                        'type' => 'object',
                        'properties' => [
                            'state_id' => ['type' => 'string'],
                            'name' => ['type' => 'string'],
                            'items' => ['type' => 'integer', 'minimum' => 1],
                        ],
                        'required' => ['state_id', 'name', 'items'],
                    ],
                    'examples' => [[['state_id' => '01J9ZQ3W8F5V6T4N2M7K1H0RAB', 'name' => 'In Review', 'items' => 4]]],
                ],
                'projects' => [
                    'type' => 'array',
                    'description' => '`in_use` (409, deleting a workflow) and `default_type` (409, archiving or deleting a type): the identifiers of the projects that hold it (a project in deletion is marked).',
                    'items' => ['type' => 'string'],
                    'examples' => [['WEB', 'OPS']],
                ],
                'issues' => [
                    'type' => 'array',
                    'description' => '`invalid_workflow` (422): what is wrong with the graph of the workflow, by the ids of the input.',
                    'items' => [
                        'type' => 'object',
                        'properties' => [
                            'code' => ['type' => 'string', 'enum' => ['no_initial_state', 'no_completed_state', 'unreachable_state']],
                            'state_id' => ['type' => 'string', 'description' => 'Only for `unreachable_state`.'],
                        ],
                        'required' => ['code'],
                    ],
                    'examples' => [[['code' => 'unreachable_state', 'state_id' => 'st_review']]],
                ],
            ],
            'required' => ['type', 'title', 'status', 'reason'],
            'x-werkbuch-open' => true,
        ];
    }

    /**
     * Rich text as Tiptap JSON: a `doc` with its nodes (the nodes the server knows, `App\RichText\Schema`).
     *
     * @return array<string, mixed>
     */
    public static function richTextDocument(): array
    {
        return [
            'type' => 'object',
            'description' => 'Rich text as Tiptap JSON (`{type: "doc", content: [...]}`); the same text is also given as Markdown.',
            'properties' => [
                'type' => ['type' => 'string', 'const' => 'doc'],
                'content' => ['type' => 'array', 'items' => ['type' => 'object']],
            ],
            'required' => ['type'],
            'x-werkbuch-open' => true,
        ];
    }

    /**
     * The links of a list (Laravel's cursor format).
     *
     * @return array<string, mixed>
     */
    public static function listLinks(): array
    {
        $link = ['type' => ['string', 'null']];

        return [
            'type' => 'object',
            'description' => 'Links to the pages of a list. A list read by `POST` has no `prev` and `next`: the same request '
                .'with `meta.next_cursor` as `cursor` leads on.',
            'properties' => ['first' => $link, 'last' => $link, 'prev' => $link, 'next' => $link],
            'required' => ['first', 'last', 'prev', 'next'],
        ];
    }

    /**
     * The meta of a list: the cursors of the neighbouring pages and the number of all matches.
     *
     * @return array<string, mixed>
     */
    public static function listMeta(): array
    {
        $cursor = ['type' => ['string', 'null']];

        return [
            'type' => 'object',
            'properties' => [
                'path' => ['type' => 'string'],
                'per_page' => ['type' => 'integer', 'minimum' => 1, 'maximum' => 100],
                'next_cursor' => $cursor,
                'prev_cursor' => $cursor,
                'total' => ['type' => 'integer', 'minimum' => 0, 'description' => 'The number of all matches.'],
            ],
            'required' => ['path', 'per_page', 'next_cursor', 'prev_cursor', 'total'],
        ];
    }

    /**
     * A filter of the work items (`App\Domain\Filter\FilterSchema`): the conditions all have to hold. The operators a
     * field takes and the form of a value depend on the field; a condition that does not fit is 422 at
     * `filter.conditions.<n>.field|op|value`.
     *
     * @return array<string, mixed>
     */
    public static function filter(): array
    {
        $scalar = ['type' => ['string', 'number', 'boolean']];
        $relative = [
            'type' => 'object',
            'description' => 'Days or weeks from today, `+7d`, `-2w`, `0d` (date fields).',
            'properties' => ['relative' => ['type' => 'string', 'pattern' => '^[+-]?\\d{1,5}[dw]$']],
            'required' => ['relative'],
        ];

        return [
            'type' => 'object',
            'description' => 'A filter: every condition has to hold. Fields are the core fields or `property:<key>` of a property. '
                .'Values: ULIDs (`me` for `assignee` and `created_by` and people properties), the words of the state categories and priorities, '
                .'days `YYYY-MM-DD` or `today`, `this_week`, `this_month`, `{relative: "+7d"}`, `true`/`false`, a text of 1–'.FilterSchema::TEXT_MAX.' characters, a number. '
                .'`in`/`not_in` take a list of 1–'.FilterSchema::MAX_VALUES.', `between` two values, `is_empty`, `is_not_empty` and `overdue` none.',
            'properties' => [
                'version' => ['type' => 'integer', 'const' => 1],
                'conditions' => [
                    'type' => 'array',
                    'maxItems' => FilterSchema::MAX_CONDITIONS,
                    'items' => [
                        'type' => 'object',
                        'properties' => [
                            'field' => [
                                'description' => 'A core field or a property, `property:<key>`.',
                                'anyOf' => [
                                    ['type' => 'string', 'enum' => array_column(CoreField::cases(), 'value')],
                                    ['type' => 'string', 'pattern' => '^'.Field::PROPERTY_PREFIX],
                                ],
                            ],
                            'op' => ['type' => 'string', 'enum' => array_column(Op::cases(), 'value')],
                            'value' => [
                                'description' => 'Left out (or `null`) for an operator without a value.',
                                'anyOf' => [
                                    ['type' => ['string', 'number', 'boolean', 'null']],
                                    $relative,
                                    ['type' => 'array', 'maxItems' => FilterSchema::MAX_VALUES, 'items' => ['anyOf' => [$scalar, $relative]]],
                                ],
                            ],
                        ],
                        'required' => ['field', 'op'],
                    ],
                ],
            ],
            'required' => ['version', 'conditions'],
        ];
    }

    /**
     * The order of a list of work items: a core field or a property of the types number, date, text or address.
     *
     * @return array<string, mixed>
     */
    public static function sortSpec(): array
    {
        return [
            'type' => 'object',
            'description' => 'The order of a list. Items of equal value follow their manual order (`rank`); `rank` alone is the manual order.',
            'properties' => [
                'field' => [
                    'anyOf' => [
                        ['type' => 'string', 'enum' => SortSpec::CORE],
                        ['type' => 'string', 'pattern' => '^'.Field::PROPERTY_PREFIX, 'description' => 'A property of the types number, date, text or address.'],
                    ],
                ],
                'direction' => ['type' => 'string', 'enum' => ['asc', 'desc']],
            ],
            'required' => ['field', 'direction'],
        ];
    }

    /**
     * How a view shows its items (`App\Domain\Views\DisplaySchema`), all five keys required.
     *
     * @return array<string, mixed>
     */
    public static function display(): array
    {
        return [
            'type' => 'object',
            'description' => 'How a list shows its items: the layout, the grouping, the order, the fields of a row and whether sub-items show.',
            'properties' => [
                'layout' => ['type' => 'string', 'enum' => array_column(Layout::cases(), 'value')],
                'group_by' => ['type' => 'string', 'enum' => array_column(GroupBy::cases(), 'value')],
                'sort' => ['$ref' => '#/components/schemas/SortSpec'],
                'fields' => [
                    'type' => 'array',
                    'maxItems' => DisplaySchema::MAX_FIELDS,
                    'items' => ['anyOf' => [
                        ['type' => 'string', 'enum' => DisplaySchema::FIELDS],
                        ['type' => 'string', 'pattern' => '^'.Field::PROPERTY_PREFIX],
                    ]],
                ],
                'show_sub_items' => ['type' => 'boolean'],
            ],
            'required' => ['layout', 'group_by', 'sort', 'fields', 'show_sub_items'],
        ];
    }
}
