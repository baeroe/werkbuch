<?php

namespace App\Models;

use App\RichText\RichTextNames;
use Database\Factories\PageVersionFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * A kept state of a page (spec 4.15): title and content as they were saved under that number, by `author_id`, at
 * `created_at` (the `updated_at` of the page back then). Never changed after it was written; one per page and number.
 * Events of the wiki always name the page, never a version (no morph entry).
 *
 * @property string $id
 * @property string $page_id
 * @property int $version
 * @property string $title
 * @property array<string, mixed>|null $content
 * @property string $author_id
 * @property Carbon|null $created_at
 * @property-read Page $page
 * @property-read User $author
 */
#[Fillable(['page_id', 'version', 'title', 'content', 'author_id', 'created_at'])]
final class PageVersion extends Model
{
    /** @use HasFactory<PageVersionFactory> */
    use HasFactory, HasUlids;

    /** Only `created_at`, set from the page, never by Eloquent. */
    public $timestamps = false;

    /** Set by the action that reads one version, never stored: whether PageVersionResource carries the content. */
    public bool $with_content = false;

    /** Set with `with_content`, never stored: what its reader may see of the mentions and references of the content. */
    public ?RichTextNames $rich_names = null;

    /**
     * @return BelongsTo<Page, $this>
     */
    public function page(): BelongsTo
    {
        return $this->belongsTo(Page::class);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function author(): BelongsTo
    {
        return $this->belongsTo(User::class, 'author_id');
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['content' => 'array', 'version' => 'int', 'created_at' => 'datetime'];
    }
}
