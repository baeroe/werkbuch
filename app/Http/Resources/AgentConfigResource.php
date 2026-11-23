<?php

namespace App\Http\Resources;

use App\Models\AgentConfig;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The agent configuration of a bot (spec 10.4) as `AgentConfig` of the clickdummy: an empty pool is every runner.
 *
 * @mixin AgentConfig
 */
final class AgentConfigResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var AgentConfig $config */
        $config = $this->resource;

        return [
            'bot_id' => $config->bot_id,
            'enabled' => $config->enabled,
            'runner_ids' => $config->runner_ids,
            'cli' => $config->cli->value,
            'model' => $config->model,
            'models' => (object) $config->models,
            'updated_at' => $config->updated_at?->toJSON(),
        ];
    }
}
