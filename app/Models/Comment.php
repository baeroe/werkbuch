<?php

namespace App\Models;

use App\RichText\RichTextNames;
use App\Support\ReaderNames;
use Database\Factories\CommentFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\MorphMany;
use Illuminate\Support\Carbon;

/**
 * A comment on a work item (spec 4.10): rich text (`body`, Tiptap JSON, and its plain text `body_text`) of one author,
 * marked `edited_at` once changed. Its events hang on the item (A227); its pictures and files are attachments it owns.
 *
 * @property string $id
 * @property string $work_item_id
 * @property string $author_id
 * @property array<string, mixed> $body
 * @property string $body_text
 * @property Carbon|null $edited_at
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read WorkItem $workItem
 * @property-read User $author
 * @property-read EloquentCollection<int, CommentReaction> $reactions
 */
#[Fillable(['work_item_id', 'author_id', 'body', 'body_text', 'edited_at'])]
final class Comment extends Model
{
    /** @use HasFactory<CommentFactory> */
    use HasFactory, HasUlids;

    /**
     * Set by loadForResource(), never stored: what its reader may see of the mentions and references of the text
     * (current handles, key and title of each referenced item the reader sees), for the Markdown of CommentResource.
     */
    public ?RichTextNames $rich_names = null;

    /**
     * Loads everything CommentResource reads, for one comment or a page, with a fixed number of queries (none per
     * comment, K5): the reactions, and the names of the texts for the reader (ReaderNames). The resource then asks the
     * database nothing.
     *
     * @param  EloquentCollection<int, self>|self  $comments
     */
    public static function loadForResource(EloquentCollection|self $comments, User $reader): void
    {
        $comments = $comments instanceof self ? $comments->newCollection([$comments]) : $comments;
        $comments->load('reactions');

        $names = ReaderNames::of($comments->map(fn (self $comment) => $comment->body)->all(), $reader);
        $comments->each(fn (self $comment) => $comment->rich_names = $names);
    }

    /**
     * @return BelongsTo<WorkItem, $this>
     */
    public function workItem(): BelongsTo
    {
        return $this->belongsTo(WorkItem::class);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function author(): BelongsTo
    {
        return $this->belongsTo(User::class, 'author_id');
    }

    /**
     * The reactions in the order they were given.
     *
     * @return HasMany<CommentReaction, $this>
     */
    public function reactions(): HasMany
    {
        return $this->hasMany(CommentReaction::class)->orderBy('created_at')->orderBy('id');
    }

    /**
     * The pictures and files of the text.
     *
     * @return MorphMany<Attachment, $this>
     */
    public function attachments(): MorphMany
    {
        return $this->morphMany(Attachment::class, 'attachable');
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['body' => 'array', 'edited_at' => 'datetime'];
    }
}
