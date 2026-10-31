<?php

namespace App\Http\Resources;

use App\Access\Visibility;
use App\Models\Project;
use App\Models\User;
use App\Support\ImageInput;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A project as `Project` of resources/js/types.ts plus `my_role`, the role of the requesting account in it (P13), so the
 * interface needs no list of all memberships. Workflow and types come with Phase 3; until then they are empty. Lists load
 * the pictures with the projects (`with('media')`).
 *
 * @mixin Project
 */
final class ProjectResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var Project $project */
        $project = $this->resource;
        $user = $request->user();

        return [
            'id' => $project->id,
            'identifier' => $project->identifier,
            'name' => $project->name,
            'description' => $project->description,
            'image_url' => ImageInput::url($project, 'image'),
            'lead_id' => $project->lead_id,
            'visibility' => $project->visibility->value,
            'workflow_id' => null,
            'enabled_type_ids' => [],
            'default_type_id' => null,
            'archived_at' => $project->archived_at?->toJSON(),
            'my_role' => $user instanceof User ? Visibility::roleIn($user, $project)?->value : null,
        ];
    }
}
