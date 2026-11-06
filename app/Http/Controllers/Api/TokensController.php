<?php

namespace App\Http\Controllers\Api;

use App\Actions\Tokens\CreateToken;
use App\Actions\Tokens\ListTokens;
use App\Actions\Tokens\RevokeToken;
use App\Http\Api\Answer;
use App\Http\Api\ApiList;
use App\Http\Api\Body;
use App\Http\Api\ListOf;
use App\Http\Controllers\Controller;
use App\Http\Resources\TokenResource;
use App\Models\PersonalAccessToken;
use App\OpenApi\AccountSchemas;
use App\Support\Actor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * The API tokens of an account: `filter[user_id]` names it (in the query to list), `user_id` (in the body to create), without it the own one.
 */
final class TokensController extends Controller
{
    /**
     * The API tokens of an account (the own one, or `filter[user_id]`).
     */
    #[ListOf(ListTokens::class)]
    public function index(Request $request): JsonResponse
    {
        return ApiList::respond(ListTokens::run(Actor::fromRequest($request), $request->query()), TokenResource::class);
    }

    /**
     * Create an API token (session only).
     *
     * Answers `{token, plain_text}` without the `data` wrapper: the plain text is shown this once.
     */
    #[Body(AccountSchemas::class, 'token')]
    #[Answer(201, AccountSchemas::class, 'tokenCreated', 'The token and its plain text, which nothing shows again.')]
    public function store(Request $request): JsonResponse
    {
        $token = CreateToken::run(Actor::fromRequest($request), $request->all());

        return response()->json([
            'token' => new TokenResource($token->accessToken),
            'plain_text' => $token->plainTextToken,
        ], 201);
    }

    /**
     * Revoke a token.
     */
    public function destroy(Request $request, PersonalAccessToken $token): Response
    {
        RevokeToken::run(Actor::fromRequest($request), $token);

        return response()->noContent();
    }
}
