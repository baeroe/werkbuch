<?php

namespace App\Actions\WorkItems;

use App\Access\Authorize;
use App\Access\Visibility;
use App\Domain\WorkItems\ItemKey;
use App\Exceptions\Problem;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use App\Support\Actor;
use App\Support\ListResult;
use App\Support\PageArgs;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The items the account sees (App\Access\Visibility, never those of a project being deleted), in manual order: rank,
 * then ULID (a unique order for the cursor, P12). A simple filter until views come (Phase 5, P8):
 *
 * - `filter[project]`: the items of one project (ULID, identifier or former identifier); unknown or unseen → 404.
 * - `filter[parent]`: the children of one item (ULID or key); unknown or unseen → 404.
 * - `filter[q]`: the key of an item the account sees names exactly that item (also with a former identifier); any other
 *   text, a key-shaped one included (`KW-45`, the key of an unseen item), is a part of the title, `%` and `_` taken
 *   literally. So a hidden key reads like an unknown one.
 * - Any other filter is a 422 at `filter`.
 * - `include_archived`: archived items and the items of archived projects only come with it.
 *
 * Every item of the page is loaded for WorkItemResource with the account as reader (K5).
 */
final class ListWorkItems
{
    use AsAction;

    /** The filters of the list; views widen them in Phase 5. */
    public const FILTERS = ['project', 'parent', 'q'];

    /**
     * @param  array<array-key, mixed>  $input  `filter` (`project`, `parent`, `q`), `include_archived` (bool), `cursor`,
     *                                          `per_page`
     * @return ListResult<WorkItem>
     *
     * @throws Problem 404 for a project or parent the account does not see
     * @throws ValidationException
     */
    public function handle(Actor $actor, array $input): ListResult
    {
        $invalid = __('field.filter.invalid');
        $valid = Validator::make($input, [
            // only the filters there are: an unknown one (`filter[assignee]`) would silently answer every item
            'filter' => ['nullable', 'array:'.implode(',', self::FILTERS)],
            'filter.project' => ['nullable', 'string'],
            'filter.parent' => ['nullable', 'string'],
            'filter.q' => ['nullable', 'string'],
            'include_archived' => ['nullable', 'boolean'],
            // the list embeds nothing (`include` is for one item): never silently answered without what was asked for
            'include' => ['prohibited'],
        ], [
            'include.prohibited' => __('field.include.list'),
            'filter.array' => $invalid,
            'filter.*.string' => $invalid,
            'include_archived.boolean' => __('field.include_archived.invalid'),
        ])->validate();
        $args = PageArgs::from($input);

        /** @var array{project?: string|null, parent?: string|null, q?: string|null} $filter */
        $filter = $valid['filter'] ?? [];
        $archived = (bool) ($valid['include_archived'] ?? false);

        $query = WorkItem::query()->visibleTo($actor->user)
            ->unless($archived, fn (Builder $query) => $query->whereNull('archived_at')
                ->whereIn('project_id', Project::query()->select('id')->whereNull('archived_at')));

        if (($filter['project'] ?? null) !== null) {
            $project = Project::findByReference($filter['project']) ?? throw Problem::notFound();
            Authorize::check($actor, 'view', $project);
            $query->where('project_id', $project->id);
        }

        if (($filter['parent'] ?? null) !== null) {
            $parent = WorkItem::findByReference($filter['parent']) ?? throw Problem::notFound();
            Authorize::check($actor, 'view', $parent);
            $query->where('parent_id', $parent->id);
        }

        $q = trim($filter['q'] ?? '');
        if ($q !== '') {
            self::search($query, $q, $actor->user);
        }

        $result = ListResult::of($query->orderBy('rank')->orderBy('id'), $args);
        WorkItem::loadForResource(new EloquentCollection($result->page->items()), $actor->user);

        return $result;
    }

    /**
     * The key of an item the reader sees names exactly that item; any other text is a part of the title (as the search
     * of the clickdummy: a key-shaped title stays findable, and an unseen key behaves like an unknown one).
     *
     * @param  Builder<WorkItem>  $query
     */
    private static function search(Builder $query, string $q, User $reader): void
    {
        $item = ItemKey::parse($q) === null ? null : WorkItem::findByReference($q);
        if ($item !== null && Visibility::roleIn($reader, $item->project) !== null) {
            $query->whereKey($item->id);

            return;
        }

        $query->where('title', 'like', '%'.str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $q).'%');
    }
}
