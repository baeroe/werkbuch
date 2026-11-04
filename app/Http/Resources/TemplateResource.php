<?php

namespace App\Http\Resources;

use App\Models\Template;
use App\RichText\Document;
use App\Support\TemplateInput;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A template of a project (`Template` in resources/js/types.ts, plan "REST"): the payload with the description as
 * Markdown for its reader (`description`, Template::$rich_names; a reference the reader may not see is
 * `[hidden](<kind>:<ulid>)`, A229) and as stored Tiptap JSON (`description_json`), the values by key (rich text as
 * JSON) and the rich text values as Markdown (`values_markdown`); the schedule in its normal form. A lean template
 * (`Template::$lean`, K24: the palette) comes without `description`, `description_json` and `values_markdown`. It asks
 * the database nothing: only after Template::loadForResource() (K5).
 *
 * @mixin Template
 */
final class TemplateResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var Template $template */
        $template = $this->resource;
        $payload = $template->payload;
        $description = TemplateInput::isDoc($payload['description'] ?? null) ? $payload['description'] : null;
        $values = (array) ($payload['values'] ?? []);

        return [
            'id' => $template->id,
            'project_id' => $template->project_id,
            'name' => $template->name,
            'payload' => [
                'type_id' => $payload['type_id'] ?? null,
                'title' => $payload['title'] ?? '',
                'description' => $this->unless($template->lean, fn () => $description === null ? null : Document::fromJson($description)->toMarkdown($template->rich_names)),
                'description_json' => $this->unless($template->lean, fn () => $description),
                'priority' => $payload['priority'] ?? 'none',
                'assignee_id' => $payload['assignee_id'] ?? null,
                'label_ids' => $payload['label_ids'] ?? [],
                'values' => (object) $values,
                'values_markdown' => $this->unless($template->lean, fn () => (object) array_map(
                    fn (array $text) => Document::fromJson($text)->toMarkdown($template->rich_names),
                    array_filter($values, TemplateInput::isDoc(...)),
                )),
                'parent_id' => $payload['parent_id'] ?? null,
                'start_offset_days' => $payload['start_offset_days'] ?? null,
                'due_offset_days' => $payload['due_offset_days'] ?? null,
            ],
            'schedule' => $template->schedule,
            'run_count' => $template->run_count,
            'last_run_at' => $template->last_run_at?->toJSON(),
            'next_run_at' => $template->next_run_at?->toJSON(),
            'created_by' => $template->created_by,
            'created_at' => $template->created_at?->toJSON(),
            'updated_at' => $template->updated_at?->toJSON(),
        ];
    }
}
