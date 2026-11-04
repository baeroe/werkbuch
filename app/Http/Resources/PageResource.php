<?php

namespace App\Http\Resources;

use App\Models\Page;
use App\RichText\Document;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A page of a wiki (`Page` in resources/js/types.ts): the text as Markdown for its reader (`content`, with the current
 * handles and the keys of the items the reader sees, Page::$rich_names; a reference to any other is
 * `[hidden](item:<ulid>)`, A229) and as stored Tiptap JSON (`content_json`), both `null` without text. A lean page
 * (`Page::$lean`: the tree, search results, references) comes without both keys (A174). It asks the database nothing:
 * only after Page::loadForResource() (K5).
 *
 * @mixin Page
 */
final class PageResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var Page $page */
        $page = $this->resource;

        return [
            'id' => $page->id,
            'project_id' => $page->project_id,
            'parent_id' => $page->parent_id,
            'rank' => $page->rank,
            'title' => $page->title,
            'emoji' => $page->emoji,
            'content' => $this->unless($page->lean, fn () => $page->content === null ? null : Document::fromJson($page->content)->toMarkdown($page->rich_names)),
            'content_json' => $this->unless($page->lean, fn () => $page->content),
            'version' => $page->version,
            'created_by' => $page->created_by,
            'created_at' => $page->created_at?->toJSON(),
            'updated_by' => $page->updated_by,
            'updated_at' => $page->updated_at?->toJSON(),
        ];
    }
}
