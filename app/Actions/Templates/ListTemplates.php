<?php

namespace App\Actions\Templates;

use App\Access\Authorize;
use App\Models\Project;
use App\Models\Template;
use App\Support\Actor;
use App\Support\ListFilter;
use App\Support\ListQuery;
use App\Support\ListResult;
use App\Support\ListSpec;
use App\Support\PageArgs;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The templates of every project the reader sees (`GET /api/v1/templates`, the palette) or of one of them
 * (`GET /api/v1/projects/{project}/templates`; `filter[project_id]` narrows the first to one, K11: a project the reader does
 * does not see is an empty list, never a 404), never of a project being deleted; archived projects are
 * read. By name and then ULID (K24: the browser groups by project), page by page (`PageArgs`). `lean` (the values of
 * Laravel's `boolean`) leaves the texts out (A174), so the list asks nothing for them.
 */
final class ListTemplates
{
    use AsAction;

    private const BOOLEANS = [true, false, 0, 1, '0', '1'];

    /** The rules of `GET /templates` (A386, K11). */
    public static function spec(): ListSpec
    {
        return new ListSpec(
            filters: [ListFilter::ulid('project_id', 'templates.project_id'), ...self::common()],
            sorts: ['name' => 'templates.name', 'created_at' => 'templates.id'],
            default: ['name'],
        );
    }

    /** The rules of `GET /projects/{project}/templates`: the project is the path. */
    public static function projectSpec(): ListSpec
    {
        return new ListSpec(
            filters: self::common(),
            sorts: ['name' => 'templates.name', 'created_at' => 'templates.id'],
            default: ['name'],
        );
    }

    /** @return list<ListFilter> */
    private static function common(): array
    {
        return [ListFilter::scope('scheduled', 'boolean', fn (Builder $query, mixed $scheduled) => $scheduled
            ? $query->whereNotNull('templates.schedule') : $query->whereNull('templates.schedule'))];
    }

    /**
     * @param  array<array-key, mixed>  $query  `filter`, `sort`, `lean`, `cursor`, `per_page`
     * @return ListResult<Template>
     *
     * @throws ValidationException
     */
    public function handle(Actor $actor, ?Project $project, array $query): ListResult
    {
        $templates = Template::query()->visibleTo($actor->user);

        if ($project !== null) {
            Authorize::check($actor, 'viewAny', Template::class, $project);
            $templates->where('templates.project_id', $project->id);
        }

        $lean = $query['lean'] ?? null;
        if ($lean !== null && ! in_array($lean, self::BOOLEANS, true)) {
            throw ValidationException::withMessages(['lean' => __('field.boolean')]);
        }

        [$templates, $signature] = ListQuery::apply($templates, $query, $project === null ? self::spec() : self::projectSpec());
        $result = ListResult::of($templates, PageArgs::from($query), $signature);
        Template::loadForResource(new Collection($result->page->items()), $actor->user, in_array($lean, [true, 1, '1'], true));

        return $result;
    }
}
