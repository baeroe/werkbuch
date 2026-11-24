<?php

namespace App\Support;

use App\Access\Permission;
use App\Access\RoleIndex;
use App\Access\Visibility;
use App\Models\AgentConfig;
use App\Models\Project;
use App\Models\User;

/**
 * The bots of a project as the agent settings show them (spec 10.3, A621): every active bot that is a member (not the
 * default bot) and the saved review agent, by name, each with its agent (on or off, CLI, default model, models per kind
 * of run) and whether it may review here. A project admin is not always an org admin and does not read the agent of a
 * bot (`GET /bots/{bot}/agent`); the review agent and "as the bot" of the models need it. Reads only.
 */
final class ProjectAgentBots
{
    /**
     * @return list<array{bot_id: string, enabled: bool, reviews: bool, cli: string, model: string, models: object}>
     */
    public static function of(Project $project, ?string $reviewer): array
    {
        $ids = array_keys(app(RoleIndex::class)->members($project));
        if ($reviewer !== null) {
            $ids[] = $reviewer;
        }

        $bots = User::query()->whereIn('id', array_values(array_unique($ids)))->where('type', 'bot')->where('is_default_bot', false)
            ->orderBy('name')->orderBy('id')->get()
            ->filter(fn (User $bot) => ! $bot->isDisabled() || $bot->id === $reviewer)->values();
        $configs = AgentConfig::query()->whereIn('bot_id', $bots->modelKeys())->get()->keyBy('bot_id');

        return array_values($bots->map(function (User $bot) use ($configs, $project) {
            $config = $configs->get($bot->id) ?? AgentConfig::unsaved($bot);
            $models = $config->models;
            ksort($models);

            return [
                'bot_id' => $bot->id,
                'enabled' => $config->enabled,
                'reviews' => self::reviews($bot, $project),
                'cli' => $config->cli->value,
                'model' => $config->model,
                'models' => (object) $models,
            ];
        })->all());
    }

    /** Whether a bot may review in a project: active, with a responsible person, not the default bot, editing items. */
    public static function reviews(User $bot, Project $project): bool
    {
        return $bot->isBot() && ! $bot->is_default_bot && $bot->owner_id !== null && ! $bot->isDisabled()
            && Visibility::can($bot, Permission::ItemEdit, $project);
    }
}
