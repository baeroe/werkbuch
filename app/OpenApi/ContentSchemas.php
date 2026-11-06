<?php

namespace App\OpenApi;

use App\Domain\Emoji;
use App\Models\Attachment;
use App\Support\AttachmentTexts;
use App\Support\ViewInput;

/**
 * The hand-written bodies and the parts of the resources Scramble cannot read for the content of work items: comments
 * and their reactions, attachments (a multipart upload), views (`#[Body]`, `Components`). Plain JSON Schema (OpenAPI
 * 3.1). All these bodies are open (`x-werkbuch-open`): the actions pass over keys they do not know (K2). `ContentDocsTest`
 * holds the keys against the `FIELDS` of the actions.
 */
final class ContentSchemas
{
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

    /**
     * @param  array<string, array<string, mixed>>  $properties
     * @param  list<string>  $required
     * @return array<string, mixed>
     */
    private static function object(string $description, array $properties, array $required = []): array
    {
        return array_filter([
            'type' => 'object',
            'description' => $description,
            'x-werkbuch-open' => true,
            'properties' => $properties,
            'required' => $required ?: null,
        ], fn (mixed $value) => $value !== null);
    }

    /**
     * `POST /work-items/{item}/comments` and `PATCH /comments/{comment}`: the text as Markdown or as Tiptap JSON.
     *
     * @return array<string, mixed>
     */
    public static function comment(): array
    {
        return self::object(
            'The text of the comment: `body` (Markdown) or `body_json` (Tiptap JSON), exactly one of them (both is 422 `field.rich_text.both`, '
                .'neither or a text with nothing in it 422 at `body`). `@handle` mentions and references (`WEB-12`) are read as the writer may use them; '
                .'a mention of someone who cannot take work in the project and a reference to an item the writer does not see stay text.',
            [
                'body' => ['type' => 'string', 'description' => 'The text as Markdown.'],
                'body_json' => [...self::ref('RichTextDocument'), 'description' => 'The text as Tiptap JSON.'],
            ],
        ) + ['oneOf' => [['required' => ['body']], ['required' => ['body_json']]]];
    }

    /**
     * `PUT` and `DELETE /comments/{comment}/reactions`.
     *
     * @return array<string, mixed>
     */
    public static function reaction(): array
    {
        return self::object(
            'The reaction: one emoji (one grapheme of at most '.Emoji::MAX_BYTES.' bytes; 👍 and 👍🏽 are two). Anyone who may comment can react; '
                .'the same emoji twice changes nothing, and only the own one is taken back.',
            ['emoji' => ['type' => 'string', 'minLength' => 1, 'maxLength' => Emoji::MAX_BYTES, 'description' => 'The emoji.']],
            ['emoji'],
        );
    }

    /**
     * `DELETE /comments/{comment}/reactions`: the emoji may also come as the query `?emoji=` (the browser does), so the body is optional.
     *
     * @return array<string, mixed>
     */
    public static function unreaction(): array
    {
        $schema = self::reaction();
        unset($schema['required']);
        $schema['description'] = 'Takes back the own reaction: `emoji` in the body or in the query (`?emoji=`), one emoji of at most '
            .Emoji::MAX_BYTES.' bytes. One that is not there changes nothing.';

        return $schema;
    }

    /**
     * `POST /attachments` (`multipart/form-data`).
     *
     * @return array<string, mixed>
     */
    public static function upload(): array
    {
        $limit = Attachment::maxMegabytes();

        return self::object(
            "A file for a text or for the file list of an item. Larger than {$limit} MB (`ATTACHMENTS_MAX_MB`) is 413 `payload_too_large` "
                .'(the answer names the limit). Whoever sees the project and may comment can upload; a file of the list needs the right to change the item. '
                .'The type is read from the content. An image or a file for a text belongs to nobody until a saved text names it; unclaimed uploads are removed after a day.',
            [
                'project_id' => ['type' => 'string', 'description' => 'The project: ULID, identifier or a former identifier.'],
                'kind' => ['type' => 'string', 'enum' => Attachment::KINDS, 'description' => '`inline` for a picture or file in a text, `file` for the file list of an item (needs `work_item_id`).'],
                'work_item_id' => ['type' => 'string', 'description' => 'For `file`: the item of the same project, ULID or key.'],
                'file' => ['type' => 'string', 'format' => 'binary', 'description' => 'The file.'],
            ],
            ['project_id', 'kind', 'file'],
        );
    }

    /**
     * `POST /views` and `PUT /views/{view}`: a view is replaced as a whole.
     *
     * @return array<string, mixed>
     */
    public static function view(): array
    {
        return self::object(
            'All four keys are required, also on `PUT`, which replaces the view as a whole; the keys of an answer sent back (`id`, `created_by`, the times) are passed over. '
                .'Every error comes in one 422, the ones of the filter and the display at their paths (`filter.conditions.0.op`).',
            [
                'name' => ['type' => 'string', 'minLength' => 1, 'maxLength' => ViewInput::NAME_MAX, 'description' => 'Trimmed.'],
                'icon' => [
                    'anyOf' => [['type' => 'string', 'enum' => ViewInput::ICONS], ['type' => 'string', 'minLength' => 1, 'maxLength' => ViewInput::ICON_MAX_BYTES]],
                    'description' => 'The name of an icon, or one emoji of at most '.ViewInput::ICON_MAX_BYTES.' bytes.',
                ],
                'filter' => [...self::ref('Filter'), 'description' => 'Which items the view shows.'],
                'display' => [...self::ref('Display'), 'description' => 'How it shows them.'],
            ],
            ViewInput::FIELDS,
        );
    }

    /**
     * What Scramble cannot read of the resources, resource → property → schema.
     *
     * @return array<string, array<string, array<string, mixed>>>
     */
    public static function patches(): array
    {
        $time = ['type' => 'string', 'format' => 'date-time'];

        return [
            'CommentResource' => [
                'body' => ['type' => 'string', 'description' => 'The text as Markdown for the reader: current handles, keys of the items they see, `[hidden](item:<ulid>)` for any other.'],
                'body_json' => [...self::ref('RichTextDocument'), 'description' => 'The text as stored; references only by ID.'],
                'created_at' => $time,
                'edited_at' => ['type' => ['string', 'null'], 'format' => 'date-time', 'description' => 'When it was last edited; `null` if never.'],
                'reactions' => [
                    'type' => 'array',
                    'description' => 'Grouped by emoji in the order of the first reaction of each; the people in the order they reacted.',
                    'items' => [
                        'type' => 'object',
                        'properties' => [
                            'emoji' => ['type' => 'string'],
                            'user_ids' => ['type' => 'array', 'items' => ['type' => 'string']],
                        ],
                        'required' => ['emoji', 'user_ids'],
                    ],
                ],
            ],
            'AttachmentResource' => [
                'owner' => [
                    'type' => ['object', 'null'],
                    'description' => 'What names it: the item (file list, or a text), a comment or a page; `null` while nobody does.',
                    'properties' => [
                        'type' => ['type' => 'string', 'enum' => AttachmentTexts::OWNERS],
                        'id' => ['type' => 'string'],
                    ],
                    'required' => ['type', 'id'],
                ],
                'kind' => ['type' => 'string', 'enum' => Attachment::KINDS],
                'size' => ['type' => 'integer', 'minimum' => 0, 'description' => 'Bytes.'],
                'url' => ['type' => 'string', 'format' => 'uri-reference', 'description' => 'The file, outside `/api/v1`: `GET /attachments/{id}` (add `?download=1` to download it). A bearer token with `read` is enough.'],
                'preview_url' => ['type' => ['string', 'null'], 'format' => 'uri-reference', 'description' => 'A smaller picture, once one was made (PNG, JPEG, WebP).'],
                'created_at' => $time,
            ],
            'ViewResource' => [
                'filter' => [...self::ref('Filter'), 'description' => 'As stored; a condition on a property that is gone stays as it was saved.'],
                'display' => self::ref('Display'),
                'created_at' => $time,
                'updated_at' => $time,
            ],
            // the rest of the page is the wiki's, Task 12; its text is reachable from the search and the references
            'PageResource' => [
                'content_json' => ['anyOf' => [self::ref('RichTextDocument'), ['type' => 'null']], 'description' => 'The text as Tiptap JSON; `null` for a page without text. Not in a lean page.'],
            ],
            'SearchResultsResource' => [
                'key_match' => ['type' => ['string', 'null'], 'pattern' => PathParameters::ULID, 'description' => 'The ULID of the item a typed key names (also a former key), when the account sees it; it also stands first in `items`.'],
            ],
        ];
    }

    /**
     * The answer of `GET /references`.
     *
     * @return array<string, mixed>
     */
    public static function references(): array
    {
        return [
            'type' => 'object',
            'properties' => ['data' => [
                'type' => 'object',
                'description' => 'Lean items and pages, in the order asked for; one the account does not see or that does not exist is left out, without a count and without a 404.',
                'properties' => [
                    'items' => ['type' => 'array', 'items' => self::ref('WorkItemResource')],
                    'pages' => ['type' => 'array', 'items' => self::ref('PageResource')],
                ],
                'required' => ['items', 'pages'],
            ]],
            'required' => ['data'],
        ];
    }
}
