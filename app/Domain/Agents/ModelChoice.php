<?php

namespace App\Domain\Agents;

/**
 * The model of a run (spec 7.7), chosen when it is queued; the first stage that fits wins:
 * 1. a model label of the item (`label`): the first in catalog order; a child of an epic without one takes the epic's,
 * 2. the model of the project for the kind (`project`),
 * 3. the model of the bot for the kind (`bot`), then its default (`default`).
 * A label or a project names a CLI and a model: for an agent with another CLI the stage is passed over. A model of the
 * bot its CLI does not know (the CLI changed) is passed over too; the last word is the default of the CLI.
 */
final class ModelChoice
{
    /**
     * @param  list<array{id: string, model: string}>  $labels  model labels of the item in catalog order
     * @param  list<array{id: string, model: string}>  $epicLabels  those of its epic (a child without one takes them)
     * @param  array<string, string>  $project  kind → `cli:model`
     * @param  array<string, string>  $bot  kind → model of the bot's CLI
     * @return array{model: string, source: string, label_id: string|null}
     */
    public static function choose(AgentCli $cli, RunType $type, array $labels, array $epicLabels, array $project, array $bot, string $botDefault): array
    {
        foreach ($labels === [] ? $epicLabels : $labels as $label) {
            $model = AgentModel::parse($label['model']);
            if ($model !== null && $model->cli === $cli) {
                return ['model' => $model->model, 'source' => 'label', 'label_id' => $label['id']];
            }
        }

        $model = AgentModel::parse($project[$type->value] ?? null);
        if ($model !== null && $model->cli === $cli) {
            return ['model' => $model->model, 'source' => 'project', 'label_id' => null];
        }

        $own = $bot[$type->value] ?? null;
        if (is_string($own) && $cli->knows($own)) {
            return ['model' => $own, 'source' => 'bot', 'label_id' => null];
        }

        return ['model' => $cli->knows($botDefault) ? $botDefault : $cli->defaultModel(), 'source' => 'default', 'label_id' => null];
    }
}
