<?php

namespace App\Http\Controllers\Api;

use App\Actions\Notifications\DeleteNotification;
use App\Actions\Notifications\ListNotifications;
use App\Actions\Notifications\MarkNotificationsRead;
use App\Actions\Notifications\MarkNotificationsUnread;
use App\Http\Api\Answer;
use App\Http\Api\ApiList;
use App\Http\Api\Body;
use App\Http\Api\ListOf;
use App\Http\Controllers\Controller;
use App\Http\Resources\NotificationResource;
use App\Models\Notification;
use App\OpenApi\OperationsSchemas;
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
    /**
     * List the inbox.
     *
     * A page of the inbox, newest first (`filter[unread]`, `filter[event]`, `cursor`, `per_page`).
     */
    #[ListOf(ListNotifications::class)]
    public function index(Request $request): JsonResponse
    {
        return ApiList::respond(ListNotifications::run(Actor::fromRequest($request), $request->query()), NotificationResource::class);
    }

    /**
     * Mark notifications read.
     *
     * By `ids`, or all with `all: true`. Answers how many changed.
     */
    #[Body(OperationsSchemas::class, 'read')]
    #[Answer(200, OperationsSchemas::class, 'updated', 'How many notifications changed.')]
    public function read(Request $request): JsonResponse
    {
        return response()->json(['updated' => MarkNotificationsRead::run(Actor::fromRequest($request), $request->all())]);
    }

    /**
     * Mark notifications unread.
     */
    #[Body(OperationsSchemas::class, 'unread')]
    #[Answer(200, OperationsSchemas::class, 'updated', 'How many notifications changed.')]
    public function unread(Request $request): JsonResponse
    {
        return response()->json(['updated' => MarkNotificationsUnread::run(Actor::fromRequest($request), $request->all())]);
    }

    /**
     * Delete a notification.
     *
     * Only one of the own inbox; 204.
     */
    public function destroy(Request $request, Notification $notification): Response
    {
        DeleteNotification::run(Actor::fromRequest($request), $notification);

        return response()->noContent();
    }
}
