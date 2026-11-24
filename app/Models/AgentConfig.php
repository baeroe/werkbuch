<?php

namespace App\Models;

use App\Domain\Agents\AgentCli;
use Database\Factories\AgentConfigFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * The agent configuration of a bot (spec 5, 10.4): on or off, the runner pool (empty: every runner of the organization,
 * A485), the CLI and its models (default and per kind of run). A bot without one is a plain API bot.
 *
 * @property string $id
 * @property string $bot_id
 * @property bool $enabled
 * @property list<string> $runner_ids
 * @property AgentCli $cli
 * @property string $model
 * @property array<string, string> $models
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read User $bot
 */
#[Fillable(['bot_id', 'enabled', 'runner_ids', 'cli', 'model', 'models'])]
final class AgentConfig extends Model
{
    /** @use HasFactory<AgentConfigFactory> */
    use HasFactory, HasUlids;

    protected function casts(): array
    {
        return [
            'enabled' => 'boolean',
            'runner_ids' => 'array',
            'cli' => AgentCli::class,
            'models' => 'array',
        ];
    }

    /** The configuration a bot has without a row: off, every runner, Claude Code with its default model. */
    public static function unsaved(User $bot): self
    {
        $config = new self(['enabled' => false, 'runner_ids' => [], 'cli' => AgentCli::Claude, 'model' => AgentCli::Claude->defaultModel(), 'models' => []]);
        $config->bot_id = $bot->id;

        return $config;
    }

    /** @return BelongsTo<User, $this> */
    public function bot(): BelongsTo
    {
        return $this->belongsTo(User::class, 'bot_id');
    }

    /** Whether a runner is in the pool; an empty pool is every runner (A485). */
    public function pools(Runner $runner): bool
    {
        return $this->runner_ids === [] || in_array($runner->id, $this->runner_ids, true);
    }
}
