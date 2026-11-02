<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * One person's emoji on a comment, once per person and emoji; the emoji compares byte by byte (P14).
 *
 * @property string $id
 * @property string $comment_id
 * @property string $user_id
 * @property string $emoji
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['comment_id', 'user_id', 'emoji'])]
final class CommentReaction extends Model
{
    use HasUlids;

    /**
     * @return BelongsTo<Comment, $this>
     */
    public function comment(): BelongsTo
    {
        return $this->belongsTo(Comment::class);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
