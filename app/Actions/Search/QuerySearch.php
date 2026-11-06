<?php

namespace App\Actions\Search;

use App\Access\Authorize;
use App\Access\Visibility;
use App\Domain\Filter\Filter;
use App\Domain\Workflow\StateCategory;
use App\Domain\WorkItems\ItemKey;
use App\Exceptions\Problem;
use App\Models\Page;
use App\Models\Project;
use App\Models\User;
use App\Models\View;
use App\Models\WorkItem;
use App\Search\SearchResults;
use App\Support\Actor;
use App\Views\ItemQuery;
use App\Views\ItemQueryInput;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Laravel\Scout\Builder as SearchBuilder;
use Lorisleiva\Actions\Concerns\AsAction;
use Meilisearch\Exceptions\ExceptionInterface;
use Psr\Http\Client\ClientExceptionInterface;

/**
 * The one search (spec 4.17): items, pages, projects, people and views at once, up to `limit` hits of each kind.
 *
 * - Every word of `q` has to hit (`matchingStrategy: all`, P13). Items, pages and projects are searched in Meilisearch
 *   only within the projects the account sees (`Visibility::projectIds`, without `include_archived` none that is
 *   archived, P3, A201) and read again from the database (ItemQuery, `Page::visibleTo`, `Project::visibleTo`): a
 *   document the index still holds (item or page deleted, project being deleted, access lost) never comes back (P2). People are active persons and bots (P7), views
 *   come from the database by every word of their name (P6).
 * - A `q` in the form of a key (`web-47`, also with a former identifier) names its item in `keyMatch` and puts it first,
 *   archived or not, but only when the account sees it: the key of a hidden item reads like an unknown one (P4, A139).
 * - `type_id`, `state_category`, `assignee_id` and `label_id` narrow the items (phase 13, K13): in the engine before it
 *   cuts at the limit, an item with any of the labels for `label_id`, `none` (alone) for items without an assignee.
 *   Their values are checked before the engine is asked, and the key match counts only when its item passes them.
 * - When the engine fails, the search answers 503 `search_unavailable` and reports the cause (P12).
 */
final class QuerySearch
{
    /**
     * What Meilisearch is asked with: every word has to hit (P13), and only the id comes back (the hits are read afresh;
     * the documents with their texts would only cost bandwidth, T12-M2).
     */
    private const OPTIONS = ['matchingStrategy' => 'all', 'attributesToRetrieve' => ['id']];

    use AsAction;

    /** The keys of the query (the OpenAPI document names them, K15); others are passed over. */
    public const KEYS = ['q', 'types', 'limit', 'include_archived', 'type_id', 'state_category', 'assignee_id', 'label_id'];

    /** The filters of items (phase 13, K13), each a list or comma text. */
    public const FILTERS = ['type_id', 'state_category', 'assignee_id', 'label_id'];

    /** `assignee_id`: the items without an assignee; only alone (the engine joins the filters of its fields with AND). */
    public const UNASSIGNED = 'none';

    /** @var list<string> */
    public const TYPES = ['items', 'pages', 'projects', 'people', 'views'];

    public const DEFAULT_LIMIT = 20;

    public const MAX_LIMIT = 50;

    public const Q_MAX = 255;

    /**
     * @param  array<array-key, mixed>  $query  `q`, `types` (comma-separated or a list), `limit` (per kind), `include_archived`,
     *                                          the filters of items `type_id`, `state_category`, `assignee_id`, `label_id`
     *
     * @throws ValidationException
     * @throws Problem 503 when the search engine does not answer
     */
    public function handle(Actor $actor, array $query): SearchResults
    {
        [$q, $types, $limit, $includeArchived, $filters] = self::input($query);
        $user = $actor->user;

        /** @var list<string> $visible */
        $visible = Visibility::projectIds($user)->all();
        /** @var list<string> $scope */
        $scope = $includeArchived ? $visible : Project::query()->whereKey($visible)->whereNull('archived_at')->pluck('id')->all();

        $keyMatch = in_array('items', $types, true) ? self::keyMatch($actor, $q, $filters) : null;

        try {
            $items = in_array('items', $types, true) ? self::items($actor, $q, $scope, $limit, $includeArchived, $keyMatch, $filters) : (new WorkItem)->newCollection();
            $pages = in_array('pages', $types, true) ? self::pages($user, $q, $scope, $limit) : (new Page)->newCollection();
            $projects = in_array('projects', $types, true) ? self::projects($user, $q, $scope, $limit) : (new Project)->newCollection();
            $people = in_array('people', $types, true) ? self::people($q, $limit) : (new User)->newCollection();
        } catch (ExceptionInterface|ClientExceptionInterface $e) {
            report($e);

            throw Problem::unavailable('search_unavailable');
        }

        $views = in_array('views', $types, true) && Authorize::allows($actor, 'viewAny', View::class)
            ? self::views($q, $limit)
            : (new View)->newCollection();

        return new SearchResults($items, $pages, $projects, $people, $views, $keyMatch?->id);
    }

    /**
     * The checked query: all field errors in one answer, other keys passed over.
     *
     * @param  array<array-key, mixed>  $query
     * @return array{string, list<string>, int, bool, array<string, list<string>>}
     *
     * @throws ValidationException
     */
    private static function input(array $query): array
    {
        $errors = [];

        $q = is_string($query['q'] ?? null) ? Str::trim($query['q']) : '';
        if ($q === '') {
            $errors['q'] = __('field.q.required');
        } elseif (mb_strlen($q) > self::Q_MAX) {
            $errors['q'] = __('field.q.max', ['max' => self::Q_MAX]);
        }

        $types = self::types($query['types'] ?? null, $errors);

        $limit = $query['limit'] ?? null;
        if ($limit === null) {
            $limit = self::DEFAULT_LIMIT;
        } elseif ((is_int($limit) || (is_string($limit) && preg_match('/^\d+\z/', $limit) === 1)) && (int) $limit >= 1 && (int) $limit <= self::MAX_LIMIT) {
            $limit = (int) $limit;
        } else {
            $errors['limit'] = __('field.limit.invalid', ['max' => self::MAX_LIMIT]);
            $limit = self::DEFAULT_LIMIT;
        }

        $flags = ItemQueryInput::flags(array_filter(['include_archived' => $query['include_archived'] ?? null], fn (mixed $value) => $value !== null), ['include_archived'], $errors);

        $filters = self::filters($query, $errors);

        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        return [$q, $types, $limit, $flags['include_archived'] ?? false, $filters];
    }

    /**
     * The kinds asked for (`items,views` or a list), all without `types`; blank names are passed over, but a `types`
     * that names no kind at all (`[]`, `,`) is refused: it would read as every kind.
     *
     * @param  array<array-key, mixed>  $errors
     * @return list<string>
     */
    private static function types(mixed $types, array &$errors): array
    {
        if ($types === null) {
            return self::TYPES;
        }

        $names = is_string($types) ? explode(',', $types) : (is_array($types) ? $types : [$types]);
        $asked = [];

        foreach ($names as $name) {
            $name = is_string($name) ? trim($name) : $name;
            if ($name === '' || $name === null) {
                continue;
            }
            if (! is_string($name) || ! in_array($name, self::TYPES, true)) {
                $errors['types'] = __('field.types.unknown', [
                    'name' => is_string($name) ? $name : get_debug_type($name),
                    'allowed' => implode(', ', self::TYPES),
                ]);

                return self::TYPES;
            }
            $asked[] = $name;
        }

        if ($asked === []) {
            $errors['types'] = __('field.types.empty', ['allowed' => implode(', ', self::TYPES)]);

            return self::TYPES;
        }

        return array_values(array_intersect(self::TYPES, $asked));
    }

    /**
     * The filters of items that were given, checked before the engine sees them: the engine writes them into the filter
     * string of Meilisearch, so a value is an ULID (any case, lower case on), a category or `none`, never other text.
     * A list or comma text; blank values are passed over, a filter without values is none.
     *
     * @param  array<array-key, mixed>  $query
     * @param  array<array-key, mixed>  $errors
     * @return array<string, list<string>>
     */
    private static function filters(array $query, array &$errors): array
    {
        $categories = array_map(fn (StateCategory $category) => $category->value, StateCategory::ORDER);
        $filters = [];

        foreach (self::FILTERS as $key) {
            $values = self::values($query[$key] ?? null);
            if ($values === []) {
                continue;
            }

            if ($values === null || ! self::valid($key, $values, $categories)) {
                $errors[$key] = match ($key) {
                    'type_id' => __('field.type_id.invalid'),
                    'state_category' => __('field.state_category.invalid', ['allowed' => implode(', ', $categories)]),
                    'assignee_id' => __('field.assignee_id.invalid'),
                    default => __('field.label_id.invalid'),
                };

                continue;
            }

            $filters[$key] = $key === 'state_category' ? $values : array_map(fn (string $value) => $value === self::UNASSIGNED ? $value : Str::lower($value), $values);
        }

        return $filters;
    }

    /**
     * Whether the values of a filter can go into the filter string of the engine: categories, ULIDs, or `none` alone
     * for the assignee (the engine cannot ask for „nobody or this account“, K13).
     *
     * @param  list<string>  $values
     * @param  list<string>  $categories
     */
    private static function valid(string $key, array $values, array $categories): bool
    {
        return match ($key) {
            'state_category' => array_all($values, fn (string $value) => in_array($value, $categories, true)),
            'assignee_id' => $values === [self::UNASSIGNED] || array_all($values, fn (string $value) => Str::isUlid($value)),
            default => array_all($values, fn (string $value) => Str::isUlid($value)),
        };
    }

    /**
     * The values of a filter, trimmed, without blank ones and doubles; `null` when it holds anything but text.
     *
     * @return list<string>|null
     */
    private static function values(mixed $given): ?array
    {
        $values = is_string($given) ? explode(',', $given) : (is_array($given) && array_is_list($given) ? $given : ($given === null ? [] : null));
        if ($values === null) {
            return null;
        }

        $texts = [];
        foreach ($values as $value) {
            if ($value === null) {
                continue;
            }
            if (! is_string($value)) {
                return null;
            }
            if (($value = trim($value)) !== '') {
                $texts[] = $value;
            }
        }

        return array_values(array_unique($texts));
    }

    /**
     * The item a key-shaped `q` names, when the account sees it (its project not being deleted), archived or not, and
     * when it passes the filters of items: it comes past the engine, which would leave it out otherwise (K13).
     *
     * @param  array<string, list<string>>  $filters
     */
    private static function keyMatch(Actor $actor, string $q, array $filters): ?WorkItem
    {
        $item = ItemKey::parse($q) === null ? null : WorkItem::findByReference($q);

        return $item !== null && Authorize::allows($actor, 'view', $item) && self::passes($item, $filters) ? $item : null;
    }

    /**
     * Whether an item passes the filters as the engine reads them: its type, the category of its state, its assignee
     * (none for `none`), any of its labels.
     *
     * @param  array<string, list<string>>  $filters
     */
    private static function passes(WorkItem $item, array $filters): bool
    {
        foreach ($filters as $key => $values) {
            $passes = match ($key) {
                'type_id' => in_array($item->type_id, $values, true),
                'state_category' => in_array($item->state->category->value, $values, true),
                'assignee_id' => $values === [self::UNASSIGNED] ? $item->assignee_id === null : in_array($item->assignee_id, $values, true),
                default => array_intersect($item->labels->modelKeys(), $values) !== [],
            };
            if (! $passes) {
                return false;
            }
        }

        return true;
    }

    /**
     * The hits of the index within the scope and the filters, read again through ItemQuery, behind the key match
     * (once), lean. The filters stand in the engine, before `take()`.
     *
     * @param  list<string>  $scope
     * @param  array<string, list<string>>  $filters
     * @return EloquentCollection<int, WorkItem>
     */
    private static function items(Actor $actor, string $q, array $scope, int $limit, bool $includeArchived, ?WorkItem $keyMatch, array $filters): EloquentCollection
    {
        $ids = [];
        if ($scope !== []) {
            $search = WorkItem::search($q)->options(self::OPTIONS)->whereIn('project_id', $scope);
            if (! $includeArchived) {
                $search->where('archived', false);
            }
            foreach ($filters as $key => $values) {
                match (true) {
                    $key === 'assignee_id' && $values === [self::UNASSIGNED] => $search->where('assignee_id', null),
                    // the document holds the labels as a list: any of them
                    $key === 'label_id' => $search->whereIn('label_ids', $values),
                    default => $search->whereIn($key, $values),
                };
            }
            $ids = self::keys($search->take($limit));
        }

        $found = $ids === [] ? (new WorkItem)->newCollection()
            : ItemQuery::for($actor, ItemQueryInput::ofFilter(Filter::empty(), $includeArchived))->whereKey($ids)->get();

        $items = self::inOrder($ids, $found)->reject(fn (WorkItem $hit) => $hit->id === $keyMatch?->id)->values();
        if ($keyMatch !== null) {
            $items->prepend($keyMatch);
        }
        $items = $items->take($limit);

        WorkItem::loadForResource($items, $actor->user, lean: true);

        return $items;
    }

    /**
     * The pages of the scope, read again through `Page::visibleTo` in the order of the index, lean (the title of a page
     * the reader no longer sees never comes back).
     *
     * @param  list<string>  $scope
     * @return EloquentCollection<int, Page>
     */
    private static function pages(User $user, string $q, array $scope, int $limit): EloquentCollection
    {
        if ($scope === []) {
            return (new Page)->newCollection();
        }

        $ids = self::keys(Page::search($q)->options(self::OPTIONS)->whereIn('project_id', $scope)->take($limit));
        $pages = self::inOrder($ids, Page::query()->visibleTo($user)->whereKey($ids)->get((new Page)->qualifyColumns(Page::LEAN_COLUMNS)));
        Page::loadForResource($pages, $user, lean: true);

        return $pages;
    }

    /**
     * The projects of the scope, read again through `Project::visibleTo`. The scope alone decides about the archive: it
     * is read from the database, so a project restored after its document was written shows at once.
     *
     * @param  list<string>  $scope
     * @return EloquentCollection<int, Project>
     */
    private static function projects(User $user, string $q, array $scope, int $limit): EloquentCollection
    {
        if ($scope === []) {
            return (new Project)->newCollection();
        }

        $ids = self::keys(Project::search($q)->options(self::OPTIONS)->whereIn('id', $scope)->take($limit));

        return self::inOrder($ids, Project::query()->visibleTo($user)->with(['media', 'types:work_item_types.id'])->whereKey($ids)->get());
    }

    /**
     * Active persons and bots.
     *
     * @return EloquentCollection<int, User>
     */
    private static function people(string $q, int $limit): EloquentCollection
    {
        $ids = self::keys(User::search($q)->options(self::OPTIONS)->where('disabled', false)->take($limit));

        return self::inOrder($ids, User::query()->with('media')->whereKey($ids)->whereNull('disabled_at')->get());
    }

    /**
     * Views whose name holds every word (`%` and `_` taken literally, case and accents by the collation), by name.
     *
     * @return EloquentCollection<int, View>
     */
    private static function views(string $q, int $limit): EloquentCollection
    {
        $query = View::query();

        foreach (preg_split('/\s+/u', $q, -1, PREG_SPLIT_NO_EMPTY) ?: [] as $word) {
            $query->where('name', 'like', '%'.str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $word).'%');
        }

        return $query->orderBy('name')->orderBy('id')->limit($limit)->get();
    }

    /**
     * The keys of the hits in the order of the index.
     *
     * @template TModel of Model
     *
     * @param  SearchBuilder<TModel>  $search
     * @return list<string>
     */
    private static function keys(SearchBuilder $search): array
    {
        return array_values(array_map(strval(...), $search->keys()->all()));
    }

    /**
     * The models found, in the order of the ids; ids without a model (gone, hidden) are left out.
     *
     * @template TModel of Model
     *
     * @param  list<string>  $ids
     * @param  EloquentCollection<int, TModel>  $found
     * @return EloquentCollection<int, TModel>
     */
    private static function inOrder(array $ids, EloquentCollection $found): EloquentCollection
    {
        $byId = [];
        foreach ($found as $model) {
            $byId[(string) $model->getKey()] = $model;
        }

        return $found->make(array_values(array_filter(array_map(fn (string $id) => $byId[$id] ?? null, $ids))));
    }
}
