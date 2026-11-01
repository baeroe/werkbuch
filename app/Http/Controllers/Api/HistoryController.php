<?php

namespace App\Http\Controllers\Api;

use App\Actions\WorkItems\ListHistory;
use App\Http\Api\ApiList;
use App\Http\Controllers\Controller;
use App\Http\Resources\HistoryEntryResource;
use App\Models\WorkItem;
use App\Support\Actor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The history of a work item. `{item}` is bound by ULID or key (routes/api.php); whether the account sees the item,
 * the action decides, and it resolves every relation for the account (HistoryEntryResource).
 */
final class HistoryController extends Controller
{
    /** A page of entries, oldest first, each event on its own (`cursor`, `per_page`). */
    public function index(Request $request, WorkItem $item): JsonResponse
    {
        return ApiList::respond(ListHistory::run(Actor::fromRequest($request), $item, $request->query()), HistoryEntryResource::class);
    }
}
