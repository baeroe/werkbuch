<?php

namespace App\Http\Controllers\Api;

use App\Actions\WorkItems\ListSubscribers;
use App\Actions\WorkItems\SetSubscription;
use App\Http\Controllers\Controller;
use App\Http\Resources\UserResource;
use App\Http\Resources\WorkItemResource;
use App\Models\WorkItem;
use App\Support\Actor;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/**
 * Who watches a work item, and watching it oneself. `{item}` is bound by ULID or key (routes/api.php); whether the
 * account sees the item, the actions decide. Watching answers the item with `subscribed` for the account.
 */
final class SubscribersController extends Controller
{
    /**
     * List who watches a work item.
     *
     * `{data: User[]}`, by name, without a page: an item has few watchers.
     */
    public function index(Request $request, WorkItem $item): AnonymousResourceCollection
    {
        return UserResource::collection(ListSubscribers::run(Actor::fromRequest($request), $item));
    }

    /**
     * Watch a work item.
     *
     * People only (a bot is 403); answers the item with `subscribed`.
     */
    public function store(Request $request, WorkItem $item): WorkItemResource
    {
        return new WorkItemResource(SetSubscription::run(Actor::fromRequest($request), $item, true));
    }

    /**
     * Stop watching a work item.
     *
     * Answers the item with `subscribed`; only a new assignment watches again on its own.
     */
    public function destroy(Request $request, WorkItem $item): WorkItemResource
    {
        return new WorkItemResource(SetSubscription::run(Actor::fromRequest($request), $item, false));
    }
}
