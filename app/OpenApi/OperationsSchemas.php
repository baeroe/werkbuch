<?php

namespace App\OpenApi;

use App\Actions\Notifications\MarkNotificationsRead;
use App\Actions\Notifications\SaveNotificationPreferences;
use App\Actions\Pages\MovePage;
use App\Actions\System\RetryFailedJobs;
use App\Actions\Templates\PreviewSchedule;
use App\Domain\Notifications\Channel;
use App\Domain\Notifications\NotificationKind;
use App\Domain\Schedule\Frequency;
use App\Domain\Schedule\Placeholders;
use App\Domain\Schedule\Schedule;
use App\Domain\Schedule\ScheduleEnd;
use App\Domain\WorkItems\Priority;
use App\Models\TemplateRun;
use App\Models\Webhook;
use App\Models\WebhookAttempt;
use App\Support\ItemInput;
use App\Support\PageInput;
use App\Support\TemplateInput;
use App\Support\WebhookInput;

/**
 * The hand-written bodies and answers of the wiki, the templates, the notifications, the system page and the webhooks
 * (`#[Body]`, `#[Answer]`) and the parts of their resources Scramble cannot read (`Components`). Plain JSON Schema
 * (OpenAPI 3.1). A body is open (`x-werkbuch-open`) where the action passes over keys it does not know (K2): all of
 * them but the schedule, whose parser refuses an unknown key (`field.schedule.shape`). `OperationsDocsTest` holds the
 * keys against the `FIELDS` of the actions.
 */
final class OperationsSchemas
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

    /** @return array<string, string|list<string>> */
    private static function stamp(bool $nullable = false): array
    {
        return ['type' => $nullable ? ['string', 'null'] : 'string', 'format' => 'date-time'];
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
     * Keys of the answer that a `PUT`/`PATCH` with the own answer sends back: passed over (A75, K2).
     *
     * @param  array<string, string|list<string>>  $types  key → type
     * @return array<string, array<string, mixed>>
     */
    private static function echoed(array $types, string $what = 'the answer'): array
    {
        return array_map(fn (string|array $type) => ['type' => $type, 'readOnly' => true, 'description' => "Part of {$what}; sent back, ignored."], $types);
    }

    /**
     * @return array<string, mixed>
     */
    private static function text(): array
    {
        return [
            'content' => ['type' => 'string', 'description' => 'The text as Markdown (`@handle` mentions, `WEB-12` references, `[Title](page:<ulid>)` links to pages). Send it or `content_json`, not both.'],
            'content_json' => [...self::ref('RichTextDocument'), 'description' => 'The text as Tiptap JSON.'],
        ];
    }

    // ---------------------------------------------------------------------------------------------------------- wiki

    /**
     * `POST /projects/{project}/pages`.
     *
     * @return array<string, mixed>
     */
    public static function pageCreate(): array
    {
        return self::object(
            'A new page at the end of its siblings. Members and admins of the project may write; a project that is archived is 409. '
                .'Every error comes in one 422. Uploads of the writer that the text names become the page\'s.',
            [
                'title' => ['type' => 'string', 'minLength' => 1, 'maxLength' => PageInput::TITLE_MAX, 'description' => 'Trimmed.'],
                'emoji' => ['type' => ['string', 'null'], 'description' => 'One emoji, or `null`/`""` for none.'],
                'parent_id' => self::ulid('A page of the same project; `null` or left out is the top level. Any other value is `field.parent_page.unknown`.', true),
                ...self::text(),
            ],
            ['title'],
        );
    }

    /**
     * `PATCH /pages/{page}`: only the keys that are sent change.
     *
     * @return array<string, mixed>
     */
    public static function pageUpdate(): array
    {
        return self::object(
            'Only the keys that are sent change; nothing changing is a no-op (the version stays, no event) also on an outdated `base_version`. '
                .'With `base_version` that is not the current version of the page the answer is 409 `page_conflict` (`current` holds the page as it is now) and nothing is written; '
                .'without it the save goes through and the state it replaces is kept as a version. A state of someone else, one that rested ten minutes and one the writer asks for with `keep_current` are kept as a version. '
                .'To send an answer back leave out `content` (the Markdown), as it comes with `content_json` and both are 422 (`field.rich_text.both`). Then a `PATCH` changes nothing.',
            [
                'title' => ['type' => 'string', 'minLength' => 1, 'maxLength' => PageInput::TITLE_MAX, 'description' => 'Trimmed; cannot be emptied.'],
                'emoji' => ['type' => ['string', 'null'], 'description' => 'One emoji; `null` or `""` removes it.'],
                ...self::text(),
                'base_version' => ['type' => ['integer', 'null'], 'minimum' => 1, 'description' => 'The `version` the client edited.'],
                'keep_current' => ['type' => ['boolean', 'null'], 'description' => 'Keep the stored state as a version before this one ("keep my version"); `null` is no.'],
                ...self::echoed(['id' => 'string', 'project_id' => 'string', 'parent_id' => ['string', 'null'], 'rank' => 'string', 'version' => 'integer',
                    'created_by' => 'string', 'created_at' => ['string', 'null'], 'updated_by' => 'string', 'updated_at' => ['string', 'null']], 'the page'),
            ],
        );
    }

    /**
     * `POST /pages/{page}/move`.
     *
     * @return array<string, mixed>
     */
    public static function pageMove(): array
    {
        return self::object(
            'Both keys are required. The page takes its subtree along. A page cannot go below itself or its own subtree (`field.parent_page.cycle`, at `parent_id`); '
                .'a parent or sibling that is no page of the project is 422. A move is no save: the version, `updated_at` and `updated_by` stay. '
                .'The same place again changes nothing.',
            [
                'parent_id' => self::ulid('The new parent, a page of the same project; `null` is the top level.', true),
                'before_id' => self::ulid('The sibling it goes in front of, a child of the new parent; `null` is the end.', true),
            ],
            MovePage::FIELDS,
        );
    }

    /**
     * `DELETE /pages/{page}`.
     *
     * @return array<string, mixed>
     */
    public static function pageDeleted(): array
    {
        return self::object('The page went with its whole subtree.', ['deleted' => ['type' => 'integer', 'minimum' => 1, 'description' => 'How many pages went (the page and everything below it).']], ['deleted'], false);
    }

    // ------------------------------------------------------------------------------------------------------ templates

    /**
     * The schedule of a template, in the normal form (`Schedule::toArray()`): the component `Schedule`.
     *
     * @return array<string, mixed>
     */
    public static function schedule(): array
    {
        return [
            'type' => 'object',
            'description' => 'When a template makes an item, on the calendar of the organisation. The fields the frequency does not use are ignored in a request and left out of an answer. '
                .'A key that is not listed is `field.schedule.shape`. A schedule without a single term is `field.schedule.never_runs`; days run from '.Schedule::FIRST_DAY.' to '.Schedule::LAST_DAY.'.',
            'properties' => [
                'frequency' => ['type' => 'string', 'enum' => array_column(Frequency::cases(), 'value')],
                'interval' => ['type' => 'integer', 'minimum' => 1, 'maximum' => Schedule::MAX_INTERVAL, 'description' => 'Every n days, weeks, months or years.'],
                'weekdays' => ['type' => 'array', 'items' => ['type' => 'integer', 'minimum' => 0, 'maximum' => 6], 'description' => 'Weekly: the days, 0 is Sunday. Empty is the weekday of `starts_on`.'],
                'month_day' => ['anyOf' => [['type' => 'integer', 'minimum' => 1, 'maximum' => 31], ['type' => 'string', 'enum' => ['last']], ['type' => 'null']], 'description' => 'Monthly: the day of the month, or `last`; `null` is the day of `starts_on`. A day the month does not have is its last day.'],
                'nth_weekday' => [
                    'type' => ['object', 'null'],
                    'description' => 'Monthly: the n-th weekday of the month; wins over `month_day`. `null` is none.',
                    'properties' => [
                        'n' => ['type' => 'integer', 'enum' => Schedule::NTH, 'description' => '1 to 4, -1 is the last.'],
                        'weekday' => ['type' => 'integer', 'minimum' => 0, 'maximum' => 6],
                    ],
                    'required' => ['n', 'weekday'],
                    'additionalProperties' => false,
                ],
                'yearly_date' => ['type' => ['string', 'null'], 'pattern' => '^\d{2}-\d{2}$', 'description' => 'Yearly: `MM-DD`; `null` is the day of `starts_on`. 02-29 runs on 02-28 in years that are not leap years.'],
                'time' => ['type' => 'string', 'pattern' => '^([01]\d|2[0-3]):[0-5]\d$', 'description' => '`HH:MM` on the clock of the organisation.'],
                'starts_on' => ['type' => 'string', 'format' => 'date'],
                'ends' => [
                    'type' => 'object',
                    'description' => 'Never, on a day (not before `starts_on`) or after a number of runs.',
                    'properties' => [
                        'type' => ['type' => 'string', 'enum' => ScheduleEnd::TYPES],
                        'date' => ['type' => 'string', 'format' => 'date', 'description' => 'With `on`.'],
                        'count' => ['type' => 'integer', 'minimum' => 1, 'maximum' => Schedule::MAX_COUNT, 'description' => 'With `count`.'],
                    ],
                    'required' => ['type'],
                    'additionalProperties' => false,
                ],
                'paused' => ['type' => 'boolean', 'description' => 'A paused schedule makes nothing; left out is not paused.'],
            ],
            'required' => ['frequency', 'interval', 'time', 'starts_on', 'ends'],
            'additionalProperties' => false,
        ];
    }

    /**
     * `POST /projects/{project}/templates` and `PUT /templates/{template}`.
     *
     * @return array<string, mixed>
     */
    public static function template(): array
    {
        return self::object(
            'All three keys are required, also on `PUT`, which replaces the template as a whole; the keys of an answer sent back (`id`, the counters, `values_markdown`) are passed over; to send an answer back leave out `payload.description` (the Markdown), as it comes with `description_json` and both are 422. Then a `PUT` changes nothing. '
                .'Members and admins of the project may write; an archived project is 409. Every error comes in one 422, the ones of the payload at `payload.<field>`, the ones of the schedule at `schedule.<field>`. '
                .'A new or a changed schedule (a pause or a resume included) counts from now: a term before that is never caught up.',
            [
                'name' => ['type' => 'string', 'minLength' => 1, 'maxLength' => TemplateInput::NAME_MAX, 'description' => 'Trimmed.'],
                'payload' => self::payloadBody(),
                'schedule' => ['anyOf' => [self::ref('Schedule'), ['type' => 'null']], 'description' => 'When it makes an item; `null` is a template to apply by hand.'],
                ...self::echoed(['id' => 'string', 'project_id' => 'string', 'run_count' => 'integer', 'last_run_at' => ['string', 'null'], 'next_run_at' => ['string', 'null'],
                    'created_by' => 'string', 'created_at' => ['string', 'null'], 'updated_at' => ['string', 'null']], 'the template'),
            ],
            TemplateInput::FIELDS,
        );
    }

    /** @return array<string, mixed> */
    private static function payloadBody(): array
    {
        return self::object(
            'The fields of the item it makes, checked like those of a new item (without the required properties and without defaults: the run takes those). '
                .'Placeholders in the title ('.implode(', ', array_map(fn (string $name) => "`{{$name}}`", Placeholders::NAMES)).') are filled when an item is made.',
            [
                'type_id' => ['type' => ['string', 'null'], 'description' => 'An active type enabled in the project (one the template already has may be archived); `null` is the default type.'],
                'title' => ['type' => 'string', 'minLength' => 1, 'maxLength' => ItemInput::TITLE_MAX, 'description' => 'Trimmed; the longest title it can make must fit too.'],
                'description' => ['type' => ['string', 'null'], 'description' => 'The description as Markdown. Send it or `description_json`, not both.'],
                'description_json' => ['anyOf' => [self::ref('RichTextDocument'), ['type' => 'null']], 'description' => 'The description as Tiptap JSON.'],
                'priority' => ['type' => ['string', 'null'], 'enum' => [...array_column(Priority::cases(), 'value'), null], 'description' => '`null` is none.'],
                'assignee_id' => self::ulid('Who takes the item; `null` is nobody.', true),
                'label_ids' => ['type' => ['array', 'null'], 'items' => ['type' => 'string', 'pattern' => self::ULID]],
                'values' => ['type' => ['object', 'array', 'null'], 'maxItems' => 0, 'description' => 'Property key → value, as the values of a new item; an empty map may come as `[]`.', 'additionalProperties' => ['anyOf' => [
                    ['type' => ['string', 'number', 'boolean', 'null']],
                    ['type' => 'array', 'items' => ['type' => 'string']],
                    self::ref('RichTextDocument'),
                ]]],
                'parent_id' => self::ulid('A parent item (an epic); `null` is none.', true),
                'start_offset_days' => ['type' => ['integer', 'null'], 'minimum' => 0, 'maximum' => TemplateInput::OFFSET_MAX, 'description' => 'Days after the day the item is made; `null` is no start date.'],
                'due_offset_days' => ['type' => ['integer', 'null'], 'minimum' => 0, 'maximum' => TemplateInput::OFFSET_MAX, 'description' => 'Days after the day the item is made, not before the start; `null` is no due date.'],
                ...self::echoed(['values_markdown' => ['object', 'array']], 'the template'),
            ],
            ['title'],
        );
    }

    /**
     * `POST /templates/preview`.
     *
     * @return array<string, mixed>
     */
    public static function preview(): array
    {
        return self::object(
            'A reading POST: nothing is saved. Any account may ask.',
            [
                'schedule' => self::ref('Schedule'),
                'title' => ['type' => ['string', 'null'], 'maxLength' => ItemInput::TITLE_MAX, 'description' => 'A title with placeholders to render at the first term.'],
                'run_count' => ['type' => ['integer', 'null'], 'minimum' => 0, 'maximum' => Schedule::MAX_COUNT, 'description' => 'The runs a schedule that ends after some has had; default 0.'],
            ],
            ['schedule'],
        );
    }

    /**
     * The answer of `POST /templates/preview`.
     *
     * @return array<string, mixed>
     */
    public static function previewed(): array
    {
        return self::object('The next terms of the schedule and the title as the first of them renders it.', ['data' => self::object('', [
            'runs' => ['type' => 'array', 'maxItems' => PreviewSchedule::RUNS, 'items' => self::stamp(), 'description' => 'The next terms after now, in UTC; none when the schedule is paused or has ended.'],
            'title' => ['type' => ['string', 'null'], 'description' => 'The title as the first term renders it (as now without a term); `null` without a title.'],
        ], ['runs', 'title'], false)], ['data'], false);
    }

    /**
     * The answer of `POST /templates/{template}/run`.
     *
     * @return array<string, mixed>
     */
    public static function ran(): array
    {
        return self::object('The run, and the item when it made one.', ['data' => self::object('', [
            'run' => self::ref('TemplateRunResource'),
            'item' => ['anyOf' => [self::ref('WorkItemResource'), ['type' => 'null']], 'description' => 'The new item; `null` when the run failed (then `run.status` is `failed` and `run.error` says why).'],
        ], ['run', 'item'], false)], ['data'], false);
    }

    // ---------------------------------------------------------------------------------------------- notifications

    /**
     * `POST /notifications/read`.
     *
     * @return array<string, mixed>
     */
    public static function read(): array
    {
        return self::object(
            'Name the notifications in `ids`, or send `all: true` for every unread one of the inbox (`mentions_only` narrows that to mentions). '
                .'Both together are 422 at `all`, `mentions_only` next to `ids` 422 at `mentions_only`. Foreign, hidden, mail-only and unknown ones are passed over without a word; a read one keeps its moment.',
            [
                'ids' => ['type' => ['array', 'null'], 'minItems' => 1, 'maxItems' => MarkNotificationsRead::MAX_IDS, 'items' => ['type' => 'string', 'pattern' => self::ULID]],
                'all' => ['type' => ['boolean', 'null'], 'description' => 'Every unread notification of the inbox.'],
                'mentions_only' => ['type' => ['boolean', 'null'], 'description' => 'With `all`: only the mentions.'],
            ],
        );
    }

    /**
     * `POST /notifications/unread`.
     *
     * @return array<string, mixed>
     */
    public static function unread(): array
    {
        return self::object(
            'The read notifications named here become unread again; foreign, hidden and unknown ones are passed over.',
            ['ids' => ['type' => 'array', 'minItems' => 1, 'maxItems' => MarkNotificationsRead::MAX_IDS, 'items' => ['type' => 'string', 'pattern' => self::ULID]]],
            ['ids'],
        );
    }

    /**
     * The answer of `POST /notifications/read` and `/unread`.
     *
     * @return array<string, mixed>
     */
    public static function updated(): array
    {
        return self::object('How many notifications changed.', ['updated' => ['type' => 'integer', 'minimum' => 0, 'description' => 'How many changed; the ones that already were as asked do not count.']], ['updated'], false);
    }

    /**
     * `PUT /notification-preferences`.
     *
     * @return array<string, mixed>
     */
    public static function preferences(): array
    {
        return self::object(
            'The cells to change; cells that are not named stay. A cell named twice: the last wins. Only people have settings (the default bot is 403). The answer is the whole matrix.',
            ['preferences' => [
                'type' => 'array',
                'maxItems' => SaveNotificationPreferences::MAX_ROWS,
                'items' => self::object('One cell; the keys of an answer (`user_id`) are passed over.', [
                    'event' => ['type' => 'string', 'enum' => array_column(NotificationKind::cases(), 'value')],
                    'channel' => ['type' => 'string', 'enum' => array_column(Channel::cases(), 'value')],
                    'enabled' => ['type' => 'boolean'],
                    ...self::echoed(['user_id' => 'string'], 'the cell'),
                ], ['event', 'channel', 'enabled']),
            ]],
            ['preferences'],
        );
    }

    // ------------------------------------------------------------------------------------------------------- system

    /**
     * `POST /system/failed-jobs/retry`.
     *
     * @return array<string, mixed>
     */
    public static function retry(): array
    {
        return self::object(
            'Put failed jobs back into their queues. With `ids` (1 to '.RetryFailedJobs::MAX_IDS.' UUIDs, from `failed_jobs`) those, unknown ones are passed over; without it all of them.',
            ['ids' => ['type' => ['array', 'null'], 'minItems' => 1, 'maxItems' => RetryFailedJobs::MAX_IDS, 'items' => ['type' => 'string', 'format' => 'uuid']]],
        );
    }

    /**
     * The answer of `POST /system/failed-jobs/retry`.
     *
     * @return array<string, mixed>
     */
    public static function retried(): array
    {
        return self::object('How many jobs went back.', ['retried' => ['type' => 'integer', 'minimum' => 0]], ['retried'], false);
    }

    /**
     * The answer of `POST /system/test-mail`.
     *
     * @return array<string, mixed>
     */
    public static function testMailed(): array
    {
        return self::object('The test mail went to the address of the account (sent in this request).', ['sent_to' => ['type' => 'string', 'description' => 'The address it went to.']], ['sent_to'], false);
    }

    // ------------------------------------------------------------------------------------------------------ webhooks

    /**
     * `POST /webhooks` and `PUT /webhooks/{webhook}`.
     *
     * @return array<string, mixed>
     */
    public static function webhook(): array
    {
        $groups = array_values(array_unique(array_map(fn (string $name) => explode('.', $name, 2)[0].'.*', Webhook::catalog())));

        return self::object(
            'All six keys are required, also on `PUT`, which replaces the webhook as a whole; the keys of an answer sent back (`id`, the stamps) are passed over, a `secret` is ignored: only the server makes one. '
                .'Organisation admins and the default bot may write. Every error comes in one 422. Changing the bot or the project cancels the deliveries that wait. '
                .'Switching it on again clears a switch-off by the system.',
            [
                'name' => ['type' => 'string', 'minLength' => 1, 'maxLength' => WebhookInput::NAME_MAX, 'description' => 'Trimmed.'],
                'url' => ['type' => 'string', 'maxLength' => WebhookInput::URL_MAX, 'description' => 'An `http` or `https` address without user or password. A name is resolved before every attempt; an address in a private or reserved network is refused (`field.url.private`, private networks only unless the instance allows them).'],
                'project_id' => self::ulid('The project whose events it gets; `null` is the whole organisation.', true),
                'events' => ['type' => 'array', 'minItems' => 1, 'items' => ['type' => 'string', 'enum' => [...Webhook::catalog(), ...$groups]], 'description' => 'Event names, or `group.*` for every event of a group; a group with all its events is stored as `group.*`.'],
                'bot_id' => self::ulid('An active bot: the webhook then reads as that bot and gets only what concerns it; `null` is none.', true),
                'active' => ['type' => 'boolean'],
                ...self::echoed(['id' => 'string', 'disabled_at' => ['string', 'null'], 'failing_since' => ['string', 'null'], 'last_success_at' => ['string', 'null'],
                    'created_by' => 'string', 'created_at' => ['string', 'null'], 'updated_at' => ['string', 'null']], 'the webhook'),
                'secret' => ['type' => 'string', 'readOnly' => true, 'description' => 'Sent back, ignored: only the server makes the secret.'],
            ],
            WebhookInput::FIELDS,
        );
    }

    /**
     * The answer of creating a webhook and of `rotate-secret`.
     *
     * @return array<string, mixed>
     */
    public static function withSecret(): array
    {
        return self::object('The webhook and its secret.', [
            'data' => self::ref('WebhookResource'),
            'secret' => ['type' => 'string', 'description' => 'Shown once: the secret that signs the deliveries (`whsec_` and 43 characters). It is not stored in a form that can be read back from the API; copy it now.'],
        ], ['data', 'secret'], false);
    }

    // ---------------------------------------------------------------------------------------------- the resources

    /**
     * What Scramble cannot read of the resources, resource → property → schema.
     *
     * @return array<string, array<string, array<string, mixed>>>
     */
    public static function patches(): array
    {
        $time = self::stamp();
        $nullTime = self::stamp(true);
        $doc = ['anyOf' => [self::ref('RichTextDocument'), ['type' => 'null']]];
        $pageText = [
            'content' => ['type' => ['string', 'null'], 'description' => 'The text as Markdown for the reader: current handles, keys of the items and titles of the pages they see, `[hidden](<kind>:<ulid>)` for any other. Not in a lean page.'],
            'content_json' => [...$doc, 'description' => 'The text as Tiptap JSON; `null` for a page without text. Not in a lean page.'],
        ];
        $values = [
            'type' => 'object',
            'description' => 'Property key → value: a text, a number, `true`/`false`, a day, the ULID of an option or an account (a list for a multiple choice), rich text as Tiptap JSON.',
            'additionalProperties' => ['anyOf' => [
                ['type' => ['string', 'number', 'boolean', 'null']],
                ['type' => 'array', 'items' => ['type' => 'string']],
                self::ref('RichTextDocument'),
            ]],
        ];

        return [
            'PageResource' => [
                ...$pageText,
                'rank' => ['type' => 'string', 'description' => 'Where it stands among its siblings; compare byte by byte.'],
                'emoji' => ['type' => ['string', 'null']],
                'version' => ['type' => 'integer', 'minimum' => 1, 'description' => 'Counts up with every save; send it back as `base_version`.'],
                'created_at' => $nullTime, 'updated_at' => $nullTime,
            ],
            'PageNodeResource' => [
                ...$pageText,
                'rank' => ['type' => 'string'],
                'emoji' => ['type' => ['string', 'null']],
                'version' => ['type' => 'integer', 'minimum' => 1],
                'created_at' => $nullTime, 'updated_at' => $nullTime,
                'children' => ['type' => 'array', 'items' => self::ref('PageNodeResource'), 'description' => 'The pages below, in order; always a list.'],
            ],
            'PageVersionResource' => [
                'created_at' => $nullTime,
                'content' => ['type' => ['string', 'null'], 'description' => 'The kept text as Markdown for the reader. Only when one version is read, not in the list.'],
                'content_json' => [...$doc, 'description' => 'The kept text as Tiptap JSON. Only when one version is read, not in the list.'],
            ],
            'TemplateResource' => [
                'payload' => self::object('The fields of the item it makes.', [
                    'type_id' => ['type' => ['string', 'null']],
                    'title' => ['type' => 'string'],
                    'description' => ['type' => ['string', 'null'], 'description' => 'As Markdown for the reader. Not in a lean template.'],
                    'description_json' => [...$doc, 'description' => 'As Tiptap JSON. Not in a lean template.'],
                    'priority' => ['type' => 'string', 'enum' => array_column(Priority::cases(), 'value')],
                    'assignee_id' => ['type' => ['string', 'null']],
                    'label_ids' => ['type' => 'array', 'items' => ['type' => 'string']],
                    'values' => $values,
                    'values_markdown' => ['type' => 'object', 'description' => 'Property key → the rich text values as Markdown for the reader. Not in a lean template.', 'additionalProperties' => ['type' => 'string']],
                    'parent_id' => ['type' => ['string', 'null']],
                    'start_offset_days' => ['type' => ['integer', 'null']],
                    'due_offset_days' => ['type' => ['integer', 'null']],
                ], ['type_id', 'title', 'priority', 'assignee_id', 'label_ids', 'values', 'parent_id', 'start_offset_days', 'due_offset_days'], false),
                'schedule' => ['anyOf' => [self::ref('Schedule'), ['type' => 'null']], 'description' => 'In the normal form; `null` without a schedule.'],
                'last_run_at' => $nullTime, 'next_run_at' => [...$nullTime, 'description' => 'The next term, `null` without a schedule, when paused or ended.'],
                'created_at' => $nullTime, 'updated_at' => $nullTime,
            ],
            'TemplateRunResource' => [
                'scheduled_for' => [...$nullTime, 'description' => 'The term; `null` for a run by hand.'],
                'ran_at' => $time,
                'status' => ['type' => 'string', 'enum' => [TemplateRun::CREATED, TemplateRun::FAILED]],
                'error' => ['type' => ['string', 'null'], 'description' => 'Why it failed, in the language of the organisation.'],
            ],
            'TemplateDraftResource' => [
                'type_id' => ['type' => ['string', 'null']],
                'description' => ['type' => ['string', 'null'], 'description' => 'As Markdown for the reader.'],
                'description_json' => [...$doc, 'description' => 'As Tiptap JSON, with the IDs of the pictures of the template.'],
                'priority' => ['type' => 'string', 'enum' => array_column(Priority::cases(), 'value')],
                'assignee_id' => ['type' => ['string', 'null']],
                'label_ids' => ['type' => 'array', 'items' => ['type' => 'string']],
                'values' => $values,
                'parent_id' => ['type' => ['string', 'null']],
                'start_date' => ['type' => ['string', 'null'], 'format' => 'date'],
                'due_date' => ['type' => ['string', 'null'], 'format' => 'date'],
            ],
            'NotificationResource' => [
                'data' => self::object(
                    'What the kind needs, ids and names only: `mentioned` has `source` (`comment`, `description`, `values`) and for a comment `comment_id`; `comment` has `comment_id`; `state_changed` has `from` and `to` (the states as they were); '
                        .'`item_changed` has `fields`; `due` has `due_date` and `overdue`; `template_run_failed` has `template_id` and `error`; `webhook_disabled` has `webhook_id` and `name`. Other kinds have none.',
                    [
                        'source' => ['type' => 'string', 'enum' => ['comment', 'description', 'values']],
                        'comment_id' => ['type' => ['string', 'null']],
                        'from' => ['anyOf' => [self::state(), ['type' => 'null']]],
                        'to' => ['anyOf' => [self::state(), ['type' => 'null']]],
                        'fields' => ['type' => 'array', 'items' => ['type' => 'string']],
                        'due_date' => ['type' => 'string', 'format' => 'date'],
                        'overdue' => ['type' => 'boolean'],
                        'template_id' => ['type' => ['string', 'null']],
                        'error' => ['type' => ['string', 'null']],
                        'webhook_id' => ['type' => ['string', 'null']],
                        'name' => ['type' => ['string', 'null']],
                    ],
                ),
                'excerpt' => ['type' => ['string', 'null'], 'description' => 'The start of the current text for the reader (a comment, or the description for a mention); `null` for the other kinds and for a comment that is gone.'],
                'read_at' => $nullTime,
                'mailed_at' => [...$nullTime, 'description' => 'When its mail went out; `null` while none did.'],
                'created_at' => $nullTime,
            ],
            'NotificationPreferenceResource' => [
                'event' => ['type' => 'string', 'enum' => array_column(NotificationKind::cases(), 'value'), 'description' => 'The kind of notification.'],
                'channel' => ['type' => 'string', 'enum' => array_column(Channel::cases(), 'value')],
                'enabled' => ['type' => 'boolean'],
            ],
            'SystemStatusResource' => [
                'queued_jobs' => ['type' => 'integer', 'minimum' => 0, 'description' => 'Jobs that are due and wait for a worker, over all queues.'],
                'delayed_jobs' => ['type' => 'integer', 'minimum' => 0, 'description' => 'Jobs that are due later (collected mails); they are no backlog.'],
                'queues' => ['type' => 'array', 'items' => self::object('One queue.', [
                    'queue' => ['type' => 'string'],
                    'pending' => ['type' => 'integer', 'minimum' => 0],
                    'oldest_at' => [...$nullTime, 'description' => 'Since when the oldest waiting job is due; `null` for an empty queue.'],
                ], ['queue', 'pending', 'oldest_at'], false)],
                'failed_jobs' => ['type' => 'array', 'description' => 'The newest 50, with the error shortened to its first sentence and without addresses\' secrets (user, password and query of a URL are cut).', 'items' => self::object('One failed job.', [
                    'id' => ['type' => 'string', 'format' => 'uuid'],
                    'queue' => ['type' => 'string'],
                    'job' => ['type' => 'string'],
                    'error' => ['type' => 'string'],
                    'failed_at' => $time,
                ], ['id', 'queue', 'job', 'error', 'failed_at'], false)],
                'failed_jobs_total' => ['type' => 'integer', 'minimum' => 0],
                'search' => ['type' => 'string', 'enum' => ['ok', 'down']],
                'search_tasks' => ['anyOf' => [self::object('The tasks of this instance\'s indexes.', [
                    'enqueued' => ['type' => 'integer', 'minimum' => 0], 'processing' => ['type' => 'integer', 'minimum' => 0], 'failed_last_day' => ['type' => 'integer', 'minimum' => 0],
                ], ['enqueued', 'processing', 'failed_last_day'], false), ['type' => 'null']], 'description' => '`null` while the search is down.'],
                'mail_configured' => ['type' => 'boolean'],
                'live' => ['type' => 'string', 'enum' => ['ok', 'down', 'off'], 'description' => '`off` when no websocket server is configured.'],
            ],
            'WebhookResource' => [
                'events' => ['type' => 'array', 'items' => ['type' => 'string'], 'description' => 'In the normal form: `group.*` for a group with all its events, otherwise the names, in the order of the catalog.'],
                'disabled_at' => [...$nullTime, 'description' => 'When the system switched it off (24 hours of failures); switching it on again clears it.'],
                'failing_since' => [...$nullTime, 'description' => 'The first failure since the last success.'],
                'last_success_at' => $nullTime,
                'created_at' => $nullTime, 'updated_at' => $nullTime,
            ],
            'WebhookDeliveryResource' => [
                'id' => ['type' => 'string', 'description' => 'The attempt.'],
                'delivery_id' => ['type' => 'string', 'description' => 'The delivery, the header `X-Werkbuch-Delivery`.'],
                'event' => ['type' => 'string', 'description' => 'The event name, `ping` for a test.'],
                'attempt' => ['type' => 'integer', 'minimum' => 1],
                'kind' => ['type' => 'string', 'enum' => WebhookAttempt::KINDS],
                'status_code' => ['type' => ['integer', 'null'], 'description' => 'The status of the answer; `null` when there was none.'],
                'duration_ms' => ['type' => 'integer', 'minimum' => 0],
                'response_excerpt' => ['type' => ['string', 'null'], 'description' => 'The first 2 KB of the answer.'],
                'error' => ['type' => ['string', 'null'], 'description' => 'Without an answer: the reason, the sentence of the error with the address cut to its host.'],
                'created_at' => [...$nullTime, 'description' => 'The time of the attempt.'],
            ],
        ];
    }

    /**
     * A state as a notification keeps it.
     *
     * @return array<string, mixed>
     */
    private static function state(): array
    {
        return self::object('A state as it was at that moment.', [
            'id' => ['type' => 'string'], 'name' => ['type' => 'string'], 'category' => ['type' => 'string'],
        ], ['id', 'name', 'category'], false);
    }
}
