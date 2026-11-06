<?php

namespace App\Http\Controllers\Api;

use App\Actions\Notifications\GetNotificationPreferences;
use App\Actions\Notifications\SaveNotificationPreferences;
use App\Http\Api\Body;
use App\Http\Controllers\Controller;
use App\Http\Resources\NotificationPreferenceResource;
use App\OpenApi\OperationsSchemas;
use App\Support\Actor;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

final class NotificationPreferencesController extends Controller
{
    /**
     * Read the notification settings.
     *
     * The whole matrix of kinds and channels, with the value that counts (the saved one or the default). A bot has none.
     */
    public function show(Request $request): AnonymousResourceCollection
    {
        return NotificationPreferenceResource::collection(GetNotificationPreferences::run(Actor::fromRequest($request)));
    }

    /**
     * Save the notification settings.
     *
     * Changes the cells that are named and answers the whole matrix.
     */
    #[Body(OperationsSchemas::class, 'preferences')]
    public function update(Request $request): AnonymousResourceCollection
    {
        return NotificationPreferenceResource::collection(SaveNotificationPreferences::run(Actor::fromRequest($request), $request->all()));
    }
}
