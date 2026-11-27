<?php

namespace App\Support;

use App\Domain\Agents\EffortChoice;
use App\Domain\Agents\ModelChoice;
use App\Domain\Agents\RunType;
use App\Models\AgentConfig;
use App\Models\AgentProjectSettings;
use App\Models\Label;
use App\Models\WorkItem;

/**
 * Reads the stages of the model (spec 7.7, ModelChoice) and the effort (WEBU-66, EffortChoice) of a run: the model labels of the item in catalog order (a
 * child of an epic without one takes the epic's), the model of the project for the kind, the models of the agent.
 */
final class RunModels
{
    /**
     * @return array{model: string, source: string, label_id: string|null}
     */
    public static function for(AgentConfig $config, RunType $type, string $projectId, ?WorkItem $item): array
    {
        return ModelChoice::choose(
            $config->cli,
            $type,
            $item === null ? [] : array_map(fn (array $label) => ['id' => $label['id'], 'model' => $label['value']], self::labels($item->id, 'agent_model')),
            $item?->parent_id === null ? [] : array_map(fn (array $label) => ['id' => $label['id'], 'model' => $label['value']], self::labels($item->parent_id, 'agent_model')),
            AgentProjectSettings::of($projectId)->models,
            $config->models,
            $config->model,
        );
    }

    /**
     * The effort of a run (WEBU-66): the same stages as the model.
     *
     * @return array{effort: string|null, source: string|null}
     */
    public static function effort(AgentConfig $config, RunType $type, string $projectId, ?WorkItem $item): array
    {
        if ($config->cli->efforts() === []) {
            return ['effort' => null, 'source' => null];
        }

        return EffortChoice::choose(
            $config->cli,
            $type,
            $item === null ? [] : array_map(fn (array $label) => ['id' => $label['id'], 'effort' => $label['value']], self::labels($item->id, 'agent_effort')),
            $item?->parent_id === null ? [] : array_map(fn (array $label) => ['id' => $label['id'], 'effort' => $label['value']], self::labels($item->parent_id, 'agent_effort')),
            AgentProjectSettings::of($projectId)->efforts ?? [],
            $config->efforts ?? [],
            $config->effort,
        );
    }

    /**
     * The labels of an item in catalog order that set the column (`agent_model` or `agent_effort`).
     *
     * @param  'agent_model'|'agent_effort'  $column
     * @return list<array{id: string, value: string}>
     */
    private static function labels(string $itemId, string $column): array
    {
        /** @var list<array{id: string, value: string}> */
        return Label::query()->whereNotNull($column)
            ->whereIn('id', WorkItem::query()->whereKey($itemId)->join('work_item_labels', 'work_item_labels.work_item_id', '=', 'work_items.id')->select('work_item_labels.label_id'))
            ->orderBy('id')->get(['id', $column])
            ->map(fn (Label $label) => ['id' => $label->id, 'value' => (string) $label->getAttribute($column)])->values()->all();
    }
}
