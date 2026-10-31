<?php

namespace App\Http\Resources;

use App\Access\Visibility;
use App\Models\Project;
use App\Models\User;
use App\Support\ImageInput;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A project as `Project` of resources/js/types.ts plus `my_role`, the role of the requesting account in it (P13), and
 * `is_member`, whether it is a member, so the interface needs no list of all memberships. `enabled_type_ids` are the
 * switched-on types in catalog order. Lists load the pictures and the types with the projects (`with(['media',
 * 'types:work_item_types.id'])`).
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
            'workflow_id' => $project->workflow_id,
            'enabled_type_ids' => $project->types->modelKeys(),
            'default_type_id' => $project->default_type_id,
            'archived_at' => $project->archived_at?->toJSON(),
            'my_role' => $user instanceof User ? Visibility::roleIn($user, $project)?->value : null,
            // org admins are admins everywhere and a public project reads as a viewer: whether the account is a member
            // (and so has nothing to join) the role alone does not say
            'is_member' => $user instanceof User && Visibility::isMember($user, $project),
        ];
    }
}
