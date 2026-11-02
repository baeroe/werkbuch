<?php

namespace App\Actions\RichText;

use App\Domain\Filter\Filter;
use App\Domain\Ulid;
use App\Models\WorkItem;
use App\Support\Actor;
use App\Views\ItemQuery;
use App\Views\ItemQueryInput;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The items the references of a text name (`{id, kind: item}`), as far as the reader sees them (A230): the stored
 * document names only the ID, so a reader learns key and title of a reference only here. Through ItemQuery with the
 * archive (an archived item or one of an archived project is still referenced), lean, in the order asked for; an item
 * the reader does not see or that does not exist is left out, without a count and without a 404 (review focus
 * "reference as an oracle").
 */
final class ResolveReferences
{
    use AsAction;

    public const MAX_ITEMS = 100;

    /**
     * @param  array<array-key, mixed>  $query  `items`: ULIDs, separated by commas or as a list
     * @return EloquentCollection<int, WorkItem>
     *
     * @throws ValidationException
     */
    public function handle(Actor $actor, array $query): EloquentCollection
    {
        $ids = self::ids($query['items'] ?? null) ?? throw ValidationException::withMessages([
            'items' => __('field.items.invalid', ['max' => self::MAX_ITEMS]),
        ]);

        $found = ItemQuery::for($actor, ItemQueryInput::ofFilter(Filter::empty(), true))->whereKey($ids)->get()->keyBy('id');
        $items = $found->make(array_values(array_filter(array_map(fn (string $id) => $found->get($id), $ids))));

        WorkItem::loadForResource($items, $actor->user, lean: true);

        return $items;
    }

    /**
     * The ULIDs asked for, in small letters, each once in the order of its first mention, blank names passed over;
     * `null` for none, more than MAX_ITEMS, or anything that is no ULID.
     *
     * @return list<string>|null
     */
    private static function ids(mixed $items): ?array
    {
        $names = is_string($items) ? explode(',', $items) : (is_array($items) ? $items : null);
        $ids = [];

        foreach ($names ?? [] as $name) {
            if (! is_string($name)) {
                return null;
            }
            $name = trim($name);
            if ($name === '') {
                continue;
            }
            if (! Ulid::is($name)) {
                return null;
            }
            $ids[strtolower($name)] = true;
        }

        return $ids === [] || count($ids) > self::MAX_ITEMS ? null : array_keys($ids);
    }
}
