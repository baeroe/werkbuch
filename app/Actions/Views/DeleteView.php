<?php

namespace App\Actions\Views;

use App\Access\Authorize;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Favorite;
use App\Models\View;
use App\Support\Actor;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Deletes a view (its creator or org admins) and takes it out of the sidebar of every person: favorites point to it
 * without a foreign key, so they go in the same transaction. The row is read afresh under `lockForUpdate`: a change or
 * a favorite at the same time waits and then finds the view gone. The event names the view in `meta.name`, the
 * subject is gone afterwards.
 */
final class DeleteView
{
    use AsAction;

    /**
     * @throws Problem 403, or 404 for a view deleted meanwhile
     */
    public function handle(Actor $actor, View $view): void
    {
        DB::transaction(function () use ($actor, $view): void {
            $current = View::query()->lockForUpdate()->find($view->id) ?? throw Problem::notFound();
            Authorize::check($actor, 'delete', $current);

            Favorite::query()->where('favoritable_type', $current->getMorphClass())->where('favoritable_id', $current->id)->delete();
            EventRecorder::record(EventType::ViewDeleted, $actor, $current, null, meta: ['name' => $current->name]);
            $current->delete();
        });
    }
}
