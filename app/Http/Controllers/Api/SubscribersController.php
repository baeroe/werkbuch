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
    /** `{data: User[]}`, by name, without a page: an item has few watchers. */
    public function index(Request $request, WorkItem $item): AnonymousResourceCollection
    {
        return UserResource::collection(ListSubscribers::run(Actor::fromRequest($request), $item));
    }

    /** Starts watching. */
    public function store(Request $request, WorkItem $item): WorkItemResource
    {
        return new WorkItemResource(SetSubscription::run(Actor::fromRequest($request), $item, true));
    }

    /** Stops watching. */
    public function destroy(Request $request, WorkItem $item): WorkItemResource
    {
        return new WorkItemResource(SetSubscription::run(Actor::fromRequest($request), $item, false));
    }
}
