<?php

namespace App\Http\Controllers\Api;

use App\Actions\Invitations\InviteUser;
use App\Actions\Invitations\ListInvitations;
use App\Http\Api\Answer;
use App\Http\Api\ApiList;
use App\Http\Api\Body;
use App\Http\Api\ListOf;
use App\Http\Controllers\Controller;
use App\Http\Resources\InvitationResource;
use App\OpenApi\AccountSchemas;
use App\Support\Actor;
use App\Support\InvitationLinks;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class InvitationsController extends Controller
{
    /**
     * The open invitations.
     */
    #[ListOf(ListInvitations::class)]
    public function index(Request $request): JsonResponse
    {
        return ApiList::respond(ListInvitations::run(Actor::fromRequest($request), $request->query()), InvitationResource::class);
    }

    /**
     * Invite an address (org admins).
     *
     * Answers `{link, invitation}` without the `data` wrapper: the link is what the admin copies when no mail goes out.
     * It stays valid seven days. A new invitation to the same address replaces the open one.
     */
    #[Body(AccountSchemas::class, 'invitation')]
    #[Answer(201, AccountSchemas::class, 'invited', 'The invitation and its link.')]
    public function store(Request $request): JsonResponse
    {
        $invitation = InviteUser::run(Actor::fromRequest($request), $request->all());

        return response()->json([
            'link' => InvitationLinks::for($invitation),
            'invitation' => new InvitationResource($invitation),
        ], 201);
    }
}
