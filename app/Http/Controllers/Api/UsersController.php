<?php

namespace App\Http\Controllers\Api;

use App\Actions\Users\DeactivateUser;
use App\Actions\Users\GetUser;
use App\Actions\Users\ListUsers;
use App\Actions\Users\ReactivateUser;
use App\Actions\Users\UpdateUser;
use App\Actions\Users\UpdateUserRole;
use App\Http\Api\ApiList;
use App\Http\Api\Body;
use App\Http\Api\ListOf;
use App\Http\Controllers\Controller;
use App\Http\Resources\UserResource;
use App\Models\User;
use App\OpenApi\AccountSchemas;
use App\Support\Actor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class UsersController extends Controller
{
    /**
     * The accounts, people before bots.
     */
    #[ListOf(ListUsers::class)]
    public function index(Request $request): JsonResponse
    {
        return ApiList::respond(ListUsers::run(Actor::fromRequest($request), $request->query()), UserResource::class);
    }

    /**
     * One account.
     */
    public function show(Request $request, User $user): UserResource
    {
        return new UserResource(GetUser::run(Actor::fromRequest($request), $user));
    }

    /**
     * Change a profile (everybody their own, org admins anybody's).
     *
     * The e-mail address of a person, the description and the responsible person of a bot are for org admins. A new
     * e-mail address only from the session of the web app: a token gets 403 `session_required`, because it could
     * otherwise take the account over through "forgot password".
     */
    #[Body(AccountSchemas::class, 'user')]
    public function update(Request $request, User $user): UserResource
    {
        return new UserResource(UpdateUser::run(Actor::fromRequest($request), $user, $request->all()));
    }

    /**
     * Set the role in the organization (org admins).
     *
     * The default bot stays admin, and the last active admin among the people stays admin (409).
     */
    #[Body(AccountSchemas::class, 'role')]
    public function updateRole(Request $request, User $user): UserResource
    {
        return new UserResource(UpdateUserRole::run(Actor::fromRequest($request), $user, $request->input('org_role')));
    }

    /**
     * Deactivate an account (org admins): its tokens and sessions end.
     */
    public function deactivate(Request $request, User $user): UserResource
    {
        return new UserResource(DeactivateUser::run(Actor::fromRequest($request), $user));
    }

    /**
     * Reactivate an account (org admins); tokens do not come back.
     */
    public function reactivate(Request $request, User $user): UserResource
    {
        return new UserResource(ReactivateUser::run(Actor::fromRequest($request), $user));
    }
}
