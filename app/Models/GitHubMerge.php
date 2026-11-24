<?php

namespace App\Models;

use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;

/**
 * A merge werkbuch makes itself (spec 7.2, 11.3): noted before the call (`started_at`) and with its commit after it
 * (`merge_sha`), so a push of the app to the base branch with that commit is no unauthorized merge (App\Support\OwnMerges).
 *
 * @property string $id
 * @property string $repository_id
 * @property int $pr_number
 * @property string|null $merge_sha
 * @property CarbonImmutable $started_at
 * @property CarbonImmutable|null $merged_at
 */
#[Fillable(['repository_id', 'pr_number', 'merge_sha', 'started_at', 'merged_at'])]
final class GitHubMerge extends Model
{
    use HasUlids;

    public $timestamps = false;

    protected $table = 'github_merges';

    protected function casts(): array
    {
        return ['pr_number' => 'integer', 'started_at' => 'immutable_datetime', 'merged_at' => 'immutable_datetime'];
    }
}
