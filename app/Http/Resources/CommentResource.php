<?php

namespace App\Http\Resources;

use App\Models\Comment;
use App\Models\CommentReaction;
use App\RichText\Document;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A comment (`Comment` in resources/js/types.ts, A243): the text as Markdown for its reader (`body`, with the current
 * handles and the keys of the items the reader sees, Comment::$rich_names; a reference to any other is
 * `[hidden](item:<ulid>)`) and as stored Tiptap JSON (`body_json`, references only by ID), and the reactions grouped
 * by emoji in the order of each emoji's first reaction, the people in the order they reacted (P9). It asks the database
 * nothing: only after Comment::loadForResource() (K5).
 *
 * @mixin Comment
 */
final class CommentResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var Comment $comment */
        $comment = $this->resource;

        $reactions = [];
        foreach ($comment->reactions as $reaction) {
            /** @var CommentReaction $reaction */
            $reactions[$reaction->emoji][] = $reaction->user_id;
        }

        return [
            'id' => $comment->id,
            'work_item_id' => $comment->work_item_id,
            'author_id' => $comment->author_id,
            'body' => Document::fromJson($comment->body)->toMarkdown($comment->rich_names),
            'body_json' => $comment->body,
            'created_at' => $comment->created_at?->toJSON(),
            'edited_at' => $comment->edited_at?->toJSON(),
            'reactions' => array_map(fn (string|int $emoji, array $users) => ['emoji' => (string) $emoji, 'user_ids' => $users], array_keys($reactions), array_values($reactions)),
        ];
    }
}
