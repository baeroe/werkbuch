<?php

namespace App\Http\Controllers\Api;

use App\Actions\Tokens\CreateToken;
use App\Actions\Tokens\ListTokens;
use App\Actions\Tokens\RevokeToken;
use App\Http\Api\ApiList;
use App\Http\Api\ListOf;
use App\Http\Controllers\Controller;
use App\Http\Resources\TokenResource;
use App\Models\PersonalAccessToken;
use App\Support\Actor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * The API tokens of an account: `filter[user_id]` names it (in the query to list), `user_id` (in the body to create), without it the own one.
 */
final class TokensController extends Controller
{
    #[ListOf(ListTokens::class)]
    public function index(Request $request): JsonResponse
    {
        return ApiList::respond(ListTokens::run(Actor::fromRequest($request), $request->query()), TokenResource::class);
    }

    /**
     * Answers `{token, plain_text}` without the `data` wrapper (P27): the plain text is shown this once.
     */
    public function store(Request $request): JsonResponse
    {
        $token = CreateToken::run(Actor::fromRequest($request), $request->all());

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
}
