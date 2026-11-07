<?php

namespace App\Http\Resources;

use App\Models\TemplateRun;
use App\Models\WorkItem;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * What a run of a template by hand gives back (`RunTemplate`): the run and the item it created, `null` when the run
 * failed (A350). It asks the database nothing.
 */
final class TemplateRunResultResource extends JsonResource
{
    /**
     * @return array{run: array<string, mixed>, item: array<string, mixed>|null}
     */
    public function toArray(Request $request): array
    {
        /** @var array{run: TemplateRun, item: WorkItem|null} $result */
        $result = $this->resource;

        return [
            'run' => (new TemplateRunResource($result['run']))->resolve($request),
            'item' => $result['item'] === null ? null : (new WorkItemResource($result['item']))->resolve($request),
        ];
    }
}
