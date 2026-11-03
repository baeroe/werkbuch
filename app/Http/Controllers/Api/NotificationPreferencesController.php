<?php

namespace App\Http\Controllers\Api;

use App\Actions\Notifications\GetNotificationPreferences;
use App\Actions\Notifications\SaveNotificationPreferences;
use App\Http\Controllers\Controller;
use App\Http\Resources\NotificationPreferenceResource;
use App\Support\Actor;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

final class NotificationPreferencesController extends Controller
{
    public function show(Request $request): AnonymousResourceCollection
    {
        return NotificationPreferenceResource::collection(GetNotificationPreferences::run(Actor::fromRequest($request)));
    }

    public function update(Request $request): AnonymousResourceCollection
    {
        return NotificationPreferenceResource::collection(SaveNotificationPreferences::run(Actor::fromRequest($request), $request->all()));
    }
}
