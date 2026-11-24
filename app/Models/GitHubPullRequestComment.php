<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * The one comment of werkbuch at a PR that names its items (spec 12): its ID at GitHub and the hash of the text it
 * holds, so that it is only written again when the text changes.
 *
 * @property string $id
 * @property int $repository_github_id
 * @property int $number
 * @property int|null $comment_id
 * @property string|null $body_hash
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['repository_github_id', 'number', 'comment_id', 'body_hash'])]
final class GitHubPullRequestComment extends Model
{
    use HasUlids;

    protected $table = 'github_pull_request_comments';

    protected function casts(): array
    {
        return ['repository_github_id' => 'integer', 'number' => 'integer', 'comment_id' => 'integer'];
    }
}
