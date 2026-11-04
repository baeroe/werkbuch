<?php

namespace App\Actions\Pages;

use App\Access\Authorize;
use App\Exceptions\Problem;
use App\Models\Page;
use App\Models\Project;
use App\Support\Actor;
use Illuminate\Database\Eloquent\Collection;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The tree of the wiki of a project (`GET /api/v1/projects/{project}/pages`, A315) for whoever sees the project, archived
 * ones too: every page in one query, without its text (`content`, `content_text` are not read), lean, by `parent_id`,
 * then the siblings by `rank` (byte by byte) and the ULID. PageNodeResource::tree() nests them. The project comes as a
 * model or as a reference (ULID, identifier or a former identifier).
 */
final class ListPages
{
    use AsAction;

    /**
     * @return Collection<int, Page>
     *
     * @throws Problem 404 when the account does not see the project
     */
    public function handle(Actor $actor, Project|string $project): Collection
    {
        $project = is_string($project) ? (Project::findByReference($project) ?? throw Problem::notFound()) : $project;
        Authorize::check($actor, 'viewAny', Page::class, $project);

        $pages = Page::query()->where('project_id', $project->id)
            ->orderBy('parent_id')->orderBy('rank')->orderBy('id')
            ->get((new Page)->qualifyColumns(Page::LEAN_COLUMNS));
        Page::loadForResource($pages, $actor->user, lean: true);

        return $pages;
    }
}
