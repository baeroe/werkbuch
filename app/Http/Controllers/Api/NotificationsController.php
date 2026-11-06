<?php

namespace App\Http\Controllers\Api;

use App\Actions\Notifications\DeleteNotification;
use App\Actions\Notifications\ListNotifications;
use App\Actions\Notifications\MarkNotificationsRead;
use App\Actions\Notifications\MarkNotificationsUnread;
use App\Http\Api\ApiList;
use App\Http\Api\ListOf;
use App\Http\Controllers\Controller;
use App\Http\Resources\NotificationResource;
use App\Models\Notification;
use App\Support\Actor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * The own inbox. `{notification}` is bound by ULID (routes/api.php) without asking whose it is: the action decides
 * (a foreign or hidden one is a 404). Marking answers `{updated}` without `data`.
 */
final class NotificationsController extends Controller
{
    /** A page of the inbox, newest first (`filter[unread]`, `filter[event]`, `cursor`, `per_page`). */
    #[ListOf(ListNotifications::class)]
    public function index(Request $request): JsonResponse
    {
        return ApiList::respond(ListNotifications::run(Actor::fromRequest($request), $request->query()), NotificationResource::class);
    }

    public function read(Request $request): JsonResponse
    {
        return response()->json(['updated' => MarkNotificationsRead::run(Actor::fromRequest($request), $request->all())]);
    }

    public function unread(Request $request): JsonResponse
    {
        return response()->json(['updated' => MarkNotificationsUnread::run(Actor::fromRequest($request), $request->all())]);
    }

    public function destroy(Request $request, Notification $notification): Response
    {
        DeleteNotification::run(Actor::fromRequest($request), $notification);

        return response()->noContent();
    }
}
