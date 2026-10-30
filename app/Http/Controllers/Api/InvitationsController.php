<?php

namespace App\Http\Controllers\Api;

use App\Actions\Invitations\InviteUser;
use App\Actions\Invitations\ListInvitations;
use App\Http\Api\ApiList;
use App\Http\Controllers\Controller;
use App\Http\Resources\InvitationResource;
use App\Support\Actor;
use App\Support\InvitationLinks;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class InvitationsController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        return ApiList::respond(ListInvitations::run(Actor::fromRequest($request), $request->query()), InvitationResource::class);
    }

    /**
     * Answers `{link, invitation}` without the `data` wrapper (P27): the link is what the admin copies when no mail goes out.
     */
    public function store(Request $request): JsonResponse
    {
        $invitation = InviteUser::run(Actor::fromRequest($request), $request->all());

        return response()->json([
            'link' => InvitationLinks::for($invitation),
            'invitation' => (new InvitationResource($invitation))->resolve($request),
        ], 201);
    }
}
