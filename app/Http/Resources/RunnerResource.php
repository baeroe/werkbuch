<?php

namespace App\Http\Resources;

use App\Domain\Agents\Places;
use App\Models\AgentRun;
use App\Models\Runner;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A runner (spec 10.1) as `Runner` of the clickdummy: never its token. Online means a contact within the last minute;
 * the places as set in werkbuch and as used now (the busy runs are loaded with it); load, CLIs and equipment as the
 * last report has them.
 *
 * @mixin Runner
 */
final class RunnerResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var Runner $runner */
        $runner = $this->resource;
        $busy = array_values($runner->busyRuns->map(fn (AgentRun $run) => ['type' => $run->type, 'repo' => $run->project_id])->all());

        return [
            'id' => $runner->id,
            'name' => $runner->name,
            'os' => $runner->os,
            'arch' => $runner->arch,
            'version' => $runner->version,
            'protocol' => $runner->protocol,
            'online' => $runner->isOnline(),
            'last_seen_at' => $runner->last_seen_at?->toJSON(),
            'slots' => ['total' => $runner->slots_total, 'per_repo' => $runner->slots_per_repo, 'light' => $runner->slots_light],
            'slots_used' => Places::used($busy),
            'load' => $runner->load === null ? null : [...$runner->load, 'measured_at' => $runner->last_seen_at?->toJSON()],
            'clis' => $runner->clis,
            'equipment' => $runner->equipment,
            'created_by' => $runner->created_by,
            'created_at' => $runner->created_at?->toJSON(),
            'updated_at' => $runner->updated_at?->toJSON(),
        ];
    }
}
