<?php

namespace App\OpenApi;

/**
 * The shared schemas of the document as plain JSON Schema (OpenAPI 3.1), stored under `components.schemas` by
 * `Components`. A schema with `x-werkbuch-open` keeps keys it does not name (the extensions of a problem, the nodes of
 * a Tiptap document); every other object of an answer is closed (A385).
 */
final class Schemas
{
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
                'reason' => ['type' => 'string', 'pattern' => '^[a-z0-9_]+$', 'description' => 'The stable code of the problem (`validation_failed`, `session_required`, …).'],
                'errors' => [
                    'type' => 'object',
                    'description' => 'The messages per field (`title`, `values.effort`, `filter.conditions.0.op`).',
                    'additionalProperties' => ['type' => 'array', 'items' => ['type' => 'string']],
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
}
