<?php

namespace App\Http\Controllers\Api;

use App\Actions\Users\CreateBot;
use App\Actions\Users\ListUsers;
use App\Http\Api\ApiList;
use App\Http\Api\ListOf;
use App\Http\Controllers\Controller;
use App\Http\Resources\UserResource;
use App\Support\Actor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The bots: their list and creating one. Changing, deactivating and the role of a bot go through /users/{user}.
 */
final class BotsController extends Controller
{
    #[ListOf(ListUsers::class, 'botSpec')]
    public function index(Request $request): JsonResponse
    {
        return ApiList::respond(ListUsers::run(Actor::fromRequest($request), $request->query(), bots: true), UserResource::class);
    }

    public function store(Request $request): UserResource
    {
        return new UserResource(CreateBot::run(Actor::fromRequest($request), $request->all()));
    }
}
