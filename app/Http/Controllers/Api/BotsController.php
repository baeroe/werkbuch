<?php

namespace App\Http\Controllers\Api;

use App\Actions\Users\CreateBot;
use App\Actions\Users\ListUsers;
use App\Http\Api\ApiList;
use App\Http\Api\Body;
use App\Http\Api\ListOf;
use App\Http\Controllers\Controller;
use App\Http\Resources\UserResource;
use App\OpenApi\AccountSchemas;
use App\Support\Actor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The bots: their list and creating one. Changing, deactivating and the role of a bot go through /users/{user}.
 */
final class BotsController extends Controller
{
    /**
     * The bots.
     */
    #[ListOf(ListUsers::class, 'botSpec')]
    public function index(Request $request): JsonResponse
    {
        return ApiList::respond(ListUsers::run(Actor::fromRequest($request), $request->query(), bots: true), UserResource::class);
    }

    /**
     * Create a bot (org admins).
     *
     * The bot answers to an active person: the one named in `owner_id`, by default the account that creates it.
     */
    #[Body(AccountSchemas::class, 'bot')]
    public function store(Request $request): JsonResponse
    {
        return (new UserResource(CreateBot::run(Actor::fromRequest($request), $request->all())))->response()->setStatusCode(201);
    }
}
