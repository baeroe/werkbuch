<?php

namespace App\Http\Resources;

use App\Models\WorkItem;
use App\RichText\Document;
use App\Support\ItemValues;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A work item, the one form for REST and later MCP, webhooks and live payloads. It asks the database nothing and does
 * not know the reader: callers load the item with WorkItem::loadForResource($items, $reader) first (K5), which also
 * decides `subscribed`. The description comes as Markdown (`description`) and as Tiptap JSON (`description_json`),
 * rich text values as JSON in `values` and as Markdown in `values_markdown`. `template_id` stays `null` until
 * templates come (Phase 10, P22); `children_progress` is `null` for an item without children. A lean item
 * (`WorkItem::$lean`, P17) comes without `description`, `description_json` and `values_markdown`. What GetWorkItem loaded
 * through `include` (`WorkItem::$includes`) comes after the fields: `children` (items in manual order), `type`
 * (WorkItemTypeResource), `workflow` (the workflow of the project, WorkflowResource) and `relations` (RelationEntryResource,
 * as the reader sees them: a hidden end without id, key or title); without it the keys are absent.
 *
 * @mixin WorkItem
 */
final class WorkItemResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var WorkItem $item */
        $item = $this->resource;
        $parent = $item->parent;

        return [
            'id' => $item->id,
            'project_id' => $item->project_id,
            'number' => $item->number,
            'key' => $item->key,
            'type_id' => $item->type_id,
            'title' => $item->title,
            'description' => $this->unless($item->lean, fn () => $item->description === null ? null : Document::fromJson($item->description)->toMarkdown()),
            'description_json' => $this->unless($item->lean, fn () => $item->description),
            'description_version' => $item->description_version,
            'state_id' => $item->state_id,
            'resolution_id' => $item->resolution_id,
            'assignee_id' => $item->assignee_id,
            'priority' => $item->priority->value,
            'label_ids' => $item->labels->modelKeys(),
            'start_date' => $item->start_date?->format('Y-m-d'),
            'due_date' => $item->due_date?->format('Y-m-d'),
            'parent_id' => $item->parent_id,
            'parent' => $parent === null ? null : ['id' => $parent->id, 'key' => $parent->key, 'title' => $parent->title, 'type_id' => $parent->type_id],
            'rank' => $item->rank,
            'values' => (object) ItemValues::of($item),
            'values_markdown' => $this->unless($item->lean, fn () => (object) ItemValues::markdown($item)),
            'created_by' => $item->created_by,
            'created_at' => $item->created_at?->toJSON(),
            'updated_at' => $item->updated_at?->toJSON(),
            'started_at' => $item->started_at?->toJSON(),
            'closed_at' => $item->closed_at?->toJSON(),
            'archived_at' => $item->archived_at?->toJSON(),
            'template_id' => null,
            'children_progress' => $item->children_total === 0 ? null : ['done' => $item->children_done, 'total' => $item->children_total],
            'blocked' => $item->is_blocked,
            'blocking' => $item->is_blocking,
            'subscribed' => $item->subscribed,
            'children' => $this->when(in_array('children', $item->includes, true), fn () => $item->children
                ->map(fn (WorkItem $child) => (new self($child))->resolve($request))->values()->all()),
            'type' => $this->when(in_array('type', $item->includes, true), fn () => (new WorkItemTypeResource($item->type))->resolve($request)),
            'workflow' => $this->when(in_array('workflow', $item->includes, true), fn () => (new WorkflowResource($item->project->workflow))->resolve($request)),
            'relations' => $this->when(in_array('relations', $item->includes, true), fn () => array_map(
                fn (array $entry) => (new RelationEntryResource($entry))->resolve($request),
                $item->relation_entries,
            )),
        ];
    }
}
