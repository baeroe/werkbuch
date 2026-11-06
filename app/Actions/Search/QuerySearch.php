<?php

namespace App\Actions\Search;

use App\Access\Authorize;
use App\Access\Visibility;
use App\Domain\Filter\Filter;
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
    public const KEYS = ['q', 'types', 'limit', 'include_archived'];

    /** @var list<string> */
    public const TYPES = ['items', 'pages', 'projects', 'people', 'views'];

    public const DEFAULT_LIMIT = 20;

    public const MAX_LIMIT = 50;

    public const Q_MAX = 255;

    /**
     * @param  array<array-key, mixed>  $query  `q`, `types` (comma-separated or a list), `limit` (per kind), `include_archived`
     *
     * @throws ValidationException
     * @throws Problem 503 when the search engine does not answer
     */
    public function handle(Actor $actor, array $query): SearchResults
    {
        [$q, $types, $limit, $includeArchived] = self::input($query);
        $user = $actor->user;

        /** @var list<string> $visible */
        $visible = Visibility::projectIds($user)->all();
        /** @var list<string> $scope */
        $scope = $includeArchived ? $visible : Project::query()->whereKey($visible)->whereNull('archived_at')->pluck('id')->all();

        $keyMatch = in_array('items', $types, true) ? self::keyMatch($actor, $q) : null;

        try {
            $items = in_array('items', $types, true) ? self::items($actor, $q, $scope, $limit, $includeArchived, $keyMatch) : (new WorkItem)->newCollection();
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
     * @return array{string, list<string>, int, bool}
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

        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        return [$q, $types, $limit, $flags['include_archived'] ?? false];
    }

    /**
     * The kinds asked for (`items,views` or a list), all without `types`; blank names are passed over.
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
            if ($name === '') {
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

        return $asked === [] ? self::TYPES : array_values(array_intersect(self::TYPES, $asked));
    }

    /** The item a key-shaped `q` names, when the account sees it (its project not being deleted); archived or not. */
    private static function keyMatch(Actor $actor, string $q): ?WorkItem
    {
        $item = ItemKey::parse($q) === null ? null : WorkItem::findByReference($q);

        return $item !== null && Authorize::allows($actor, 'view', $item) ? $item : null;
    }

    /**
     * The hits of the index within the scope, read again through ItemQuery, behind the key match (once), lean.
     *
     * @param  list<string>  $scope
     * @return EloquentCollection<int, WorkItem>
     */
    private static function items(Actor $actor, string $q, array $scope, int $limit, bool $includeArchived, ?WorkItem $keyMatch): EloquentCollection
    {
        $ids = [];
        if ($scope !== []) {
            $search = WorkItem::search($q)->options(self::OPTIONS)->whereIn('project_id', $scope);
            if (! $includeArchived) {
                $search->where('archived', false);
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
