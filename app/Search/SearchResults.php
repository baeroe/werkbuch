<?php

namespace App\Search;

use App\Models\Project;
use App\Models\User;
use App\Models\View;
use App\Models\WorkItem;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;

/**
 * What QuerySearch found, per kind in the order of its hits; kinds not asked for are empty. `keyMatch` is the ULID of the
 * item a typed key names (also over a former identifier), when the reader sees it; it stands first in `items`.
 */
final readonly class SearchResults
{
    /**
     * @param  EloquentCollection<int, WorkItem>  $items  lean, loaded for the resource
     * @param  EloquentCollection<int, Project>  $projects
     * @param  EloquentCollection<int, User>  $people
     * @param  EloquentCollection<int, View>  $views
     */
    public function __construct(
        public EloquentCollection $items,
        public EloquentCollection $projects,
        public EloquentCollection $people,
        public EloquentCollection $views,
        public ?string $keyMatch,
    ) {}
}
