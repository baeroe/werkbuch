<?php

namespace App\Models;

use Database\Factories\AgentProjectSettingsFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * The agent settings of a project (spec 10.3): the review agent, the text for agents (spec 7.3, layer 4), the model per
 * kind of run (`cli:model`, spec 7.7), the brakes (spec 7.2), whether PRs of persons are reviewed and whether the app
 * comments at PRs (spec 12), the merge method and the setup and teardown commands of a worktree (spec 8.4). A project
 * without a row has the defaults (`of`).
 *
 * @property string $id
 * @property string $project_id
 * @property string|null $review_bot_id
 * @property string|null $instructions
 * @property array<string, string> $models
 * @property array<string, string>|null $efforts
 * @property int $max_corrections
 * @property int $max_conflicts
 * @property bool $review_person_prs
 * @property bool $comment_on_pr
 * @property string $merge_method
 * @property string|null $setup_command
 * @property string|null $stop_command
 * @property string|null $teardown_command
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read User|null $reviewBot
 */
#[Fillable(['project_id', 'review_bot_id', 'instructions', 'models', 'efforts', 'max_corrections', 'max_conflicts', 'review_person_prs', 'comment_on_pr', 'merge_method', 'setup_command', 'stop_command', 'teardown_command'])]
final class AgentProjectSettings extends Model
{
    /** @use HasFactory<AgentProjectSettingsFactory> */
    use HasFactory, HasUlids;

    public const MERGE_METHODS = ['squash', 'merge', 'rebase'];

    /** The defaults of a project without a row. */
    public const DEFAULTS = [
        'review_bot_id' => null, 'instructions' => null, 'models' => [], 'efforts' => [], 'max_corrections' => 3, 'max_conflicts' => 2,
        'review_person_prs' => true, 'comment_on_pr' => true, 'merge_method' => 'squash', 'setup_command' => null, 'stop_command' => null, 'teardown_command' => null,
    ];

    protected function casts(): array
    {
        return ['models' => 'array', 'efforts' => 'array', 'max_corrections' => 'integer', 'max_conflicts' => 'integer', 'review_person_prs' => 'boolean', 'comment_on_pr' => 'boolean'];
    }

    /** The settings of a project: its row, or the defaults unsaved. */
    public static function of(string $projectId): self
    {
        $settings = self::query()->where('project_id', $projectId)->first();
        if ($settings !== null) {
            return $settings;
        }

        $settings = new self(self::DEFAULTS);
        $settings->project_id = $projectId;

        return $settings;
    }

    /** @return BelongsTo<User, $this> */
    public function reviewBot(): BelongsTo
    {
        return $this->belongsTo(User::class, 'review_bot_id');
    }
}
