<?php

namespace App\Actions\RichText;

use App\Domain\Filter\Filter;
use App\Domain\Ulid;
use App\Models\Page;
use App\Models\WorkItem;
use App\Support\Actor;
use App\Views\ItemQuery;
use App\Views\ItemQueryInput;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The items and pages the references of a text name (`{id, kind: item|page}`), as far as the reader sees them (A230,
 * A316): the stored document names only the ID, so a reader learns key and title of a reference only here. Items
 * through ItemQuery with the archive (an archived item or one of an archived project is still referenced), pages
 * through Page::visibleTo (an archived project's too, never one being deleted); both lean, in the order asked for. One
 * the reader does not see or that does not exist is left out, without a count and without a 404 (review focus
 * "reference as an oracle"); an ID names an item only under `items` and a page only under `pages`.
 */
final class ResolveReferences
{
    use AsAction;

    /** The most IDs of one call, items and pages together. */
    public const MAX_ITEMS = 100;

    /**
     * @param  array<array-key, mixed>  $query  `items` and `pages`: ULIDs, separated by commas or as a list; at least one
     *                                          and at most MAX_ITEMS over both
     * @return array{items: EloquentCollection<int, WorkItem>, pages: EloquentCollection<int, Page>}
     *
     * @throws ValidationException
     */
    public function handle(Actor $actor, array $query): array
    {
        $items = self::ids($query['items'] ?? null);
        $pages = self::ids($query['pages'] ?? null);
        $total = count($items ?? []) + count($pages ?? []);
        $errors = [];
        if ($items === null || ($total === 0 && $pages !== null) || ($total > self::MAX_ITEMS && $items !== [])) {
            $errors['items'] = __('field.items.invalid', ['max' => self::MAX_ITEMS]);
        }
        if ($pages === null || ($total > self::MAX_ITEMS && $pages !== [])) {
            $errors['pages'] = __('field.pages.invalid', ['max' => self::MAX_ITEMS]);
        }
        if ($errors !== [] || $items === null || $pages === null) {
            throw ValidationException::withMessages($errors);
        }

        $found = $items === [] ? new EloquentCollection : ItemQuery::for($actor, ItemQueryInput::ofFilter(Filter::empty(), true))->whereKey($items)->get()->keyBy('id');
        $items = new EloquentCollection(self::ordered($found, $items));
        WorkItem::loadForResource($items, $actor->user, lean: true);

        $seen = $pages === [] ? new EloquentCollection : Page::query()->visibleTo($actor->user)->whereKey($pages)->get((new Page)->qualifyColumns(Page::LEAN_COLUMNS))->keyBy('id');
        $pages = new EloquentCollection(self::ordered($seen, $pages));
        Page::loadForResource($pages, $actor->user, lean: true);

        return ['items' => $items, 'pages' => $pages];
    }

    /**
     * The models found, in the order of the IDs asked for; those not found left out.
     *
     * @template TModel of WorkItem|Page
     *
     * @param  EloquentCollection<array-key, TModel>  $found  keyed by ID
     * @param  list<string>  $ids
     * @return list<TModel>
     */
    private static function ordered(EloquentCollection $found, array $ids): array
    {
        return array_values(array_filter(array_map(fn (string $id) => $found->get($id), $ids)));
    }

    /**
     * The ULIDs asked for, in small letters, each once in the order of its first mention, blank names passed over;
     * an empty list for none, `null` for anything that is no ULID.
     *
     * @return list<string>|null
     */
    private static function ids(mixed $names): ?array
    {
        $names = $names === null ? [] : (is_string($names) ? explode(',', $names) : (is_array($names) ? $names : null));
        $ids = [];

        foreach ($names ?? [] as $name) {
            if (! is_string($name)) {
                return null;
            }
            $name = Str::trim($name);
            if ($name === '') {
                continue;
            }
            if (! Ulid::is($name)) {
                return null;
            }
            $ids[strtolower($name)] = true;
        }

        return $names === null ? null : array_map(strval(...), array_keys($ids));
    }
}
