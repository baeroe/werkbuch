<?php

namespace App\Http\Resources;

use App\Models\WorkItemLink;
use App\Models\WorkItemLinkCheck;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A PR linked to an item (spec 10.6, 12): number, title, state, draft, branches, head commit, whether it closes the item,
 * who opened it (an agent's PR names its strand), the review verdict, the CI state of its head commit and its check runs.
 * Asks nothing: GetWorkItem loads the checks.
 *
 * @mixin WorkItemLink
 */
final class WorkItemLinkResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var WorkItemLink $link */
        $link = $this->resource;

        return [
            'id' => $link->id,
            'work_item_id' => $link->work_item_id,
            'kind' => $link->kind,
            'repository' => $link->repository,
            'number' => $link->number,
            'title' => $link->title,
            /** @format uri */
            'url' => $link->url,
            'state' => $link->state,
            'draft' => $link->draft,
            'head_branch' => $link->head_branch,
            'base_branch' => $link->base_branch,
            'head_sha' => $link->head_sha,
            'closes' => $link->closes,
            'author' => $link->author,
            'thread_id' => $link->thread_id,
            'review' => $link->review,
            'ci' => $link->ci(),
            'checks' => collect($link->headChecks())->map(fn (WorkItemLinkCheck $check) => [
                'name' => $check->name,
                'app' => $check->app,
                'status' => $check->status,
                'conclusion' => $check->conclusion,
                'url' => $check->url,
            ])->values()->all(),
            'merged_at' => $link->merged_at?->toJSON(),
            'created_at' => $link->created_at?->toJSON(),
            'updated_at' => $link->updated_at?->toJSON(),
        ];
    }
}
