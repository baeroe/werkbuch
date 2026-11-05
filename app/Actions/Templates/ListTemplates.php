<?php

namespace App\Actions\Templates;

use App\Access\Authorize;
use App\Exceptions\Problem;
use App\Models\Project;
use App\Models\Template;
use App\Support\Actor;
use App\Support\ListResult;
use App\Support\PageArgs;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The templates of every project the reader sees (`GET /api/v1/templates`, the palette) or of one of them
 * (`GET /api/v1/projects/{project}/templates`, `?project=`), never of a project being deleted; archived projects are
 * read. By name and then ULID (K24: the browser groups by project), page by page (`PageArgs`). `lean` (the values of
 * Laravel's `boolean`) leaves the texts out (A174), so the list asks nothing for them.
 */
final class ListTemplates
{
    use AsAction;

    private const BOOLEANS = [true, false, 0, 1, '0', '1'];

    /**
     * @param  array<array-key, mixed>  $query  `lean`, `cursor`, `per_page`
     * @return ListResult<Template>
     *
     * @throws Problem 404 for a project the reader does not see
     * @throws ValidationException
     */
    public function handle(Actor $actor, Project|string|null $project, array $query): ListResult
    {
        $templates = Template::query()->visibleTo($actor->user)->orderBy('templates.name')->orderBy('templates.id');

        if ($project !== null) {
            $project = is_string($project) ? (Project::findByReference($project) ?? throw Problem::notFound()) : $project;
            Authorize::check($actor, 'viewAny', Template::class, $project);
            $templates->where('templates.project_id', $project->id);
        }

        $lean = $query['lean'] ?? null;
        if ($lean !== null && ! in_array($lean, self::BOOLEANS, true)) {
            throw ValidationException::withMessages(['lean' => __('field.boolean')]);
        }

        $result = ListResult::of($templates, PageArgs::from($query));
        Template::loadForResource(new Collection($result->page->items()), $actor->user, in_array($lean, [true, 1, '1'], true));

        return $result;
    }
}
