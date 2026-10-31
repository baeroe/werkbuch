<?php

namespace App\Http\Resources;

use App\Access\RoleIndex;
use App\Models\Project;
use App\Models\ProjectMember;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A membership as `ProjectMember` of resources/js/types.ts. The role is kept by spatie; it comes from the RoleIndex (one
 * query for all members of a project per request). Lists load the projects with the memberships (`with('project')`).
 *
 * @mixin ProjectMember
 */
final class ProjectMemberResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var ProjectMember $member */
        $member = $this->resource;
        /** @var Project $project */
        $project = $member->project;

        return [
            'project_id' => $member->project_id,
            'user_id' => $member->user_id,
            'role' => app(RoleIndex::class)->members($project)[$member->user_id]->value,
        ];
    }
}
