<?php

namespace App\Actions\Projects;

use App\Access\Authorize;
use App\Models\Project;
use App\Models\ProjectMember;
use App\Support\Actor;
use App\Support\ListResult;
use App\Support\PageArgs;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The members of one project, in the order they joined (the ULID of the membership, a unique order for the cursor, P12),
 * for everybody who sees the project. There is no list across projects (P13): the own role comes with `Project.my_role`.
 */
final class ListMembers
{
    use AsAction;

    /**
     * @param  array<array-key, mixed>  $input  `cursor`, `per_page`
     * @return ListResult<ProjectMember>
     *
     * @throws ValidationException
     */
    public function handle(Actor $actor, Project $project, array $input): ListResult
    {
        Authorize::check($actor, 'viewMembers', $project);

        return ListResult::of(ProjectMember::query()->with('project')->where('project_id', $project->id)->orderBy('id'), PageArgs::from($input));
    }
}
