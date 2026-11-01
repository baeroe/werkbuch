<?php

namespace App\Actions\Favorites;

use App\Access\Visibility;
use App\Models\Favorite;
use App\Models\View;
use App\Support\Actor;
use App\Support\ListResult;
use App\Support\PageArgs;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The own favorites, projects and views together, in the order of the sidebar (`position`, then ULID). A project the
 * account no longer sees drops out at once (removed from a private project, deleted), and comes back with the access;
 * a view is there while it exists (DeleteView takes its favorites with it).
 */
final class ListFavorites
{
    use AsAction;

    /**
     * @param  array<array-key, mixed>  $input  `cursor`, `per_page`
     * @return ListResult<Favorite>
     *
     * @throws ValidationException
     */
    public function handle(Actor $actor, array $input = []): ListResult
    {
        $query = Favorite::query()
            ->where('user_id', $actor->user->id)
            ->where(fn (Builder $either) => $either
                ->where(fn (Builder $q) => $q->where('favoritable_type', 'project')->whereIn('favoritable_id', Visibility::projectIds($actor->user)))
                ->orWhere(fn (Builder $q) => $q->where('favoritable_type', 'view')->whereIn('favoritable_id', View::query()->select('id'))))
            ->orderBy('position')
            ->orderBy('id');

        return ListResult::of($query, PageArgs::from($input));
    }
}
