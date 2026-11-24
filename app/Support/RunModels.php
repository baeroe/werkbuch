<?php

namespace App\Support;

use App\Domain\Agents\ModelChoice;
use App\Domain\Agents\RunType;
use App\Models\AgentConfig;
use App\Models\AgentProjectSettings;
use App\Models\Label;
use App\Models\WorkItem;

/**
 * Reads the stages of the model of a run (spec 7.7) for ModelChoice: the model labels of the item in catalog order (a
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
            $item === null ? [] : self::labels($item->id),
            $item?->parent_id === null ? [] : self::labels($item->parent_id),
            AgentProjectSettings::of($projectId)->models,
            $config->models,
            $config->model,
        );
    }

    /**
     * The model labels of an item in catalog order.
     *
     * @return list<array{id: string, model: string}>
     */
    private static function labels(string $itemId): array
    {
        /** @var list<array{id: string, model: string}> */
        return Label::query()->whereNotNull('agent_model')
            ->whereIn('id', WorkItem::query()->whereKey($itemId)->join('work_item_labels', 'work_item_labels.work_item_id', '=', 'work_items.id')->select('work_item_labels.label_id'))
            ->orderBy('id')->get(['id', 'agent_model'])
            ->map(fn (Label $label) => ['id' => $label->id, 'model' => (string) $label->agent_model])->values()->all();
    }
}
