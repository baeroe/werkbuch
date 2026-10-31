<?php

namespace App\Http\Controllers\Api;

use App\Actions\Tokens\CreateToken;
use App\Actions\Tokens\ListTokens;
use App\Actions\Tokens\RevokeToken;
use App\Http\Api\ApiList;
use App\Http\Controllers\Controller;
use App\Http\Resources\TokenResource;
use App\Models\PersonalAccessToken;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * The API tokens of an account: `user_id` names it (in the query to list, in the body to create), without it the own one.
 */
final class TokensController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $actor = Actor::fromRequest($request);

        return ApiList::respond(ListTokens::run($actor, self::owner($request->query('user_id'), $actor), $request->query()), TokenResource::class);
    }

    /**
     * Answers `{token, plain_text}` without the `data` wrapper (P27): the plain text is shown this once.
     */
    public function store(Request $request): JsonResponse
    {
        $actor = Actor::fromRequest($request);
        $token = CreateToken::run($actor, self::owner($request->input('user_id'), $actor), $request->all());

        return response()->json([
            'token' => (new TokenResource($token->accessToken))->resolve($request),
            'plain_text' => $token->plainTextToken,
        ], 201);
    }

    public function destroy(Request $request, PersonalAccessToken $token): Response
    {
        RevokeToken::run(Actor::fromRequest($request), $token);

        return response()->noContent();
    }

    /** The account a `user_id` names (404 for an unknown one, anything but a text is unknown), else the actor's own. */
    private static function owner(mixed $id, Actor $actor): User
    {
        return $id === null ? $actor->user : User::query()->findOrFail(is_string($id) ? $id : '');
    }
}
