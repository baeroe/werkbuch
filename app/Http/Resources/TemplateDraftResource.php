<?php

namespace App\Http\Resources;

use App\RichText\Document;
use App\RichText\RichTextNames;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The draft of an item from a template (`TemplateDraft` in resources/js/types.ts, A335): the fields of
 * DraftFromTemplate::input(), the description as Markdown for the reader (`description`; a reference the reader may not
 * see is `[hidden](<kind>:<ulid>)`, A229) and as Tiptap JSON with the ids of the template's own pictures
 * (`description_json`), the values by key (rich text as JSON). It asks the database nothing (K5).
 */
final class TemplateDraftResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var array<string, mixed> $draft */
        $draft = $this->resource;
        /** @var ?array<string, mixed> $description */
        $description = $draft['description'];
        /** @var ?RichTextNames $names */
        $names = $draft['rich_names'] ?? null;

        return [
            'project_id' => $draft['project_id'],
            'template_id' => $draft['template_id'],
            'type_id' => $draft['type_id'],
            'title' => $draft['title'],
            'description' => $description === null ? null : Document::fromJson($description)->toMarkdown($names),
            'description_json' => $description,
            'priority' => $draft['priority'],
            'assignee_id' => $draft['assignee_id'],
            'label_ids' => $draft['label_ids'],
            'values' => (object) $draft['values'],
            'parent_id' => $draft['parent_id'],
            'start_date' => $draft['start_date'],
            'due_date' => $draft['due_date'],
        ];
    }
}
