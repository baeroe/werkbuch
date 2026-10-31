<?php

namespace App\Http\Controllers\Api;

use App\Actions\Users\DeactivateUser;
use App\Actions\Users\ListUsers;
use App\Actions\Users\ReactivateUser;
use App\Actions\Users\UpdateUser;
use App\Actions\Users\UpdateUserRole;
use App\Http\Api\ApiList;
use App\Http\Controllers\Controller;
use App\Http\Resources\UserResource;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class UsersController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        return ApiList::respond(ListUsers::run(Actor::fromRequest($request), $request->query()), UserResource::class);
    }

    public function update(Request $request, User $user): UserResource
    {
        return new UserResource(UpdateUser::run(Actor::fromRequest($request), $user, $request->all()));
    }

    public function updateRole(Request $request, User $user): UserResource
    {
        $role = $request->input('org_role');

        // anything but a text is no role; the action names the field
        return new UserResource(UpdateUserRole::run(Actor::fromRequest($request), $user, is_string($role) ? $role : ''));
    }

    public function deactivate(Request $request, User $user): UserResource
    {
        return new UserResource(DeactivateUser::run(Actor::fromRequest($request), $user));
    }

    public function reactivate(Request $request, User $user): UserResource
    {
        return new UserResource(ReactivateUser::run(Actor::fromRequest($request), $user));
    }
}
