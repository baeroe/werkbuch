<?php

namespace App\Http\Resources;

use App\Models\PageVersion;
use App\RichText\Document;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A kept version of a page (`PageVersion` in resources/js/types.ts): number, title, author and the time of the kept
 * state. Read one at a time (`PageVersion::$with_content`, GetPageVersion), it carries its text as Markdown for its
 * reader (`content`, with PageVersion::$rich_names; a reference the reader may not see is `[hidden](item:<ulid>)`, A229)
 * and as kept Tiptap JSON (`content_json`), both `null` without text; in the list both keys are missing (A315). It asks
 * the database nothing (K5).
 *
 * @mixin PageVersion
 */
final class PageVersionResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var PageVersion $version */
        $version = $this->resource;

        return [
            'id' => $version->id,
            'page_id' => $version->page_id,
            'version' => $version->version,
            'title' => $version->title,
            'author_id' => $version->author_id,
            'created_at' => $version->created_at?->toJSON(),
            'content' => $this->when($version->with_content, fn () => $version->content === null ? null : Document::fromJson($version->content)->toMarkdown($version->rich_names)),
            'content_json' => $this->when($version->with_content, fn () => $version->content),
        ];
    }
}
