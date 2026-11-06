<?php

namespace App\Actions\Projects;

use App\Access\Authorize;
use App\Enums\AccountType;
use App\Models\Project;
use App\Models\ProjectMember;
use App\Support\Actor;
use App\Support\ListFilter;
use App\Support\ListQuery;
use App\Support\ListResult;
use App\Support\ListSpec;
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

    /** The rules of the list (A386, K11): the role lives in spatie, so it is no filter; the name comes from `users` (alias `sort_name`). */
    public static function spec(): ListSpec
    {
        return new ListSpec(
            filters: [ListFilter::exact('type', 'users.type', array_column(AccountType::cases(), 'value'))],
            sorts: ['name' => 'sort_name'],
        );
    }

    /**
     * @param  array<array-key, mixed>  $input  `filter[type]`, `sort`, `cursor`, `per_page`
     * @return ListResult<ProjectMember>
     *
     * @throws ValidationException
     */
    public function handle(Actor $actor, Project $project, array $input): ListResult
    {
        Authorize::check($actor, 'viewMembers', $project);

        $members = ProjectMember::query()->with('project')
            ->join('users', 'users.id', '=', 'project_members.user_id')
            ->select('project_members.*', 'users.name as sort_name')
            ->where('project_members.project_id', $project->id);
        [$query, $signature] = ListQuery::apply($members, $input, self::spec());

        return ListResult::of($query, PageArgs::from($input), $signature);
    }
}
