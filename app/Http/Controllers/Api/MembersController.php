<?php

namespace App\Http\Controllers\Api;

use App\Actions\Projects\AddMember;
use App\Actions\Projects\JoinProject;
use App\Actions\Projects\ListMembers;
use App\Actions\Projects\RemoveMember;
use App\Actions\Projects\UpdateMemberRole;
use App\Http\Api\ApiList;
use App\Http\Controllers\Controller;
use App\Http\Resources\ProjectMemberResource;
use App\Models\Project;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * The members of a project and joining it. `{project}` is bound by ULID, identifier or former identifier (routes/api.php);
 * whether the account sees it, the action decides.
 */
final class MembersController extends Controller
{
    public function index(Request $request, Project $project): JsonResponse
    {
        return ApiList::respond(ListMembers::run(Actor::fromRequest($request), $project, $request->query()), ProjectMemberResource::class);
    }

    public function store(Request $request, Project $project): JsonResponse
    {
        return (new ProjectMemberResource(AddMember::run(Actor::fromRequest($request), $project, $request->all())))
            ->response()->setStatusCode(201);
    }

    public function join(Request $request, Project $project): JsonResponse
    {
        return (new ProjectMemberResource(JoinProject::run(Actor::fromRequest($request), $project)))
            ->response()->setStatusCode(201);
    }

    public function update(Request $request, Project $project, User $user): ProjectMemberResource
    {
        $role = $request->input('role');

        // anything but a text is no role; the action names the field
        return new ProjectMemberResource(UpdateMemberRole::run(Actor::fromRequest($request), $project, $user, is_string($role) ? $role : ''));
    }

    public function destroy(Request $request, Project $project, User $user): Response
    {
        RemoveMember::run(Actor::fromRequest($request), $project, $user);

        return response()->noContent();
    }
}
