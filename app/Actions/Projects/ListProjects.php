<?php

namespace App\Actions\Projects;

use App\Access\Authorize;
use App\Access\Visibility;
use App\Enums\ProjectVisibility;
use App\Models\Project;
use App\Models\ProjectMember;
use App\Models\User;
use App\Support\Actor;
use App\Support\ListFilter;
use App\Support\ListQuery;
use App\Support\ListResult;
use App\Support\ListSpec;
use App\Support\PageArgs;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The projects the account sees (App\Access\Visibility), by name, then ULID (a unique order for the cursor, P12).
 * Archived projects leave the navigation (spec 4.4), so they only come with `include_archived`. `include=members` loads
 * the memberships of the page with one query (K13).
 */
final class ListProjects
{
    use AsAction;

    /**
     * The rules of the list (A386). `member` asks whether the reader is a member of the project (not just able to see
     * it); `created_at` is the ULID (the column can be null). `updated_at` is no sort: the column can be null.
     */
    public static function spec(?User $reader = null): ListSpec
    {
        return new ListSpec(
            filters: [
                ListFilter::exact('visibility', 'projects.visibility', array_column(ProjectVisibility::cases(), 'value')),
                ListFilter::ulid('lead_id', 'projects.lead_id'),
                ListFilter::ulid('workflow_id', 'projects.workflow_id'),
                ListFilter::scope('member', 'boolean', function (Builder $query, mixed $member) use ($reader) {
                    $mine = ProjectMember::query()->where('user_id', $reader === null ? '' : $reader->id)->select('project_id');

                    return $member ? $query->whereIn('projects.id', $mine) : $query->whereNotIn('projects.id', $mine);
                }),
            ],
            sorts: ['name' => 'projects.name', 'identifier' => 'projects.identifier', 'created_at' => 'projects.id'],
            default: ['name'],
            includes: ['members'],
        );
    }

    /**
     * @param  array<array-key, mixed>  $input  `include_archived` (bool), `filter`, `sort`, `include`, `cursor`, `per_page`
     * @return ListResult<Project>
     *
     * @throws ValidationException
     */
    public function handle(Actor $actor, array $input): ListResult
    {
        Authorize::check($actor, 'viewAny', Project::class);

        $valid = Validator::make($input, [
            'include_archived' => ['nullable', 'boolean'],
        ], [
            'include_archived.boolean' => __('field.include_archived.invalid'),
        ])->validate();

        $query = Project::query()->with(['media', 'types:work_item_types.id'])->visibleTo($actor->user)
            ->unless((bool) ($valid['include_archived'] ?? false), fn ($query) => $query->whereNull('projects.archived_at'));
        [$query, $signature] = ListQuery::apply($query, $input, self::spec($actor->user));

        $result = ListResult::of($query, PageArgs::from($input), $signature);
        // the roles of all members of the page in one query, only for `include=members` (the resource asks nothing per project)
        if (in_array('members', explode(',', (string) ($input['include'] ?? '')), true)) {
            Visibility::loadMembers($result->page->items());
        }

        return $result;
    }
}
