<?php

namespace App\Http\Controllers\Api;

use App\Actions\WorkItems\CreateWorkItem;
use App\Http\Controllers\Controller;
use App\Http\Resources\WorkItemResource;
use App\Models\WorkItem;
use App\Support\Actor;
use Illuminate\Http\Request;

/**
 * The work items. `{item}` is bound by ULID or key (`WEB-12`, any case, also with a former identifier, routes/api.php);
 * whether the account sees the item, the action decides. Every item leaves through WorkItem::loadForResource() with the
 * account as reader.
 */
final class WorkItemsController extends Controller
{
    /** 201: the new item was just created. */
    public function store(Request $request): WorkItemResource
    {
        $actor = Actor::fromRequest($request);
        $item = CreateWorkItem::run($actor, $request->all());
        WorkItem::loadForResource($item, $actor->user);

        return new WorkItemResource($item);
    }
}
