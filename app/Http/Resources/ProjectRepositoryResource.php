<?php

namespace App\Http\Resources;

use App\Models\ProjectRepository;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The repo of a project (spec 10.3): the repo (loaded with it), the base branch, whether a ruleset protects it (`null`:
 * not known) and the guard against an unauthorized merge (`null` while none holds the project).
 *
 * @mixin ProjectRepository
 */
final class ProjectRepositoryResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var ProjectRepository $link */
        $link = $this->resource;
        $repository = $link->repository;

        return [
            'project_id' => $link->project_id,
            'repository' => [
                'id' => $repository->id,
                'full_name' => $repository->full_name,
                'private' => $repository->private,
                'default_branch' => $repository->default_branch,
                'html_url' => $repository->html_url,
                'removed_at' => $repository->removed_at?->toJSON(),
            ],
            'base_branch' => $link->base_branch,
            'protected' => $link->protected,
            'protected_checked_at' => $link->protected_checked_at?->toJSON(),
            'guard' => ! $link->guarded() ? null : [
                'detected_at' => $link->guard_detected_at?->toJSON(),
                'sha' => $link->guard_sha,
                'branch' => $link->guard_branch,
                'runs' => $link->guard_runs ?? [],
            ],
            'updated_at' => $link->updated_at?->toJSON(),
        ];
    }
}
