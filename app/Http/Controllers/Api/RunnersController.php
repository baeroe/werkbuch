<?php

namespace App\Http\Controllers\Api;

use App\Actions\Runners\GetRunner;
use App\Actions\Runners\ListRunners;
use App\Actions\Runners\RevokeRunner;
use App\Actions\Runners\UpdateRunner;
use App\Http\Api\Answer;
use App\Http\Api\ApiList;
use App\Http\Api\Body;
use App\Http\Api\ListOf;
use App\Http\Controllers\Controller;
use App\Http\Resources\RunnerResource;
use App\Models\Runner;
use App\OpenApi\AgentSchemas;
use App\Support\Actor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The runners of the organization (spec 10.1): org admins and the default bot. `{runner}` is bound by ULID only (any
 * case). Pairing a new one goes through `runner-pairings`, only from the session.
 */
final class RunnersController extends Controller
{
    /**
     * List the runners.
     *
     * The active runners by name; never a token.
     */
    #[ListOf(ListRunners::class)]
    public function index(Request $request): JsonResponse
    {
        return ApiList::respond(ListRunners::run(Actor::fromRequest($request), $request->query()), RunnerResource::class);
    }

    /**
     * Read a runner.
     */
    public function show(Request $request, Runner $runner): RunnerResource
    {
        return new RunnerResource(GetRunner::run(Actor::fromRequest($request), $runner)->load('busyRuns'));
    }

    /**
     * Rename a runner or set its places.
     *
     * Only the keys sent change; the runner gets the places with its next answer.
     */
    #[Body(AgentSchemas::class, 'runner')]
    public function update(Request $request, Runner $runner): RunnerResource
    {
        return new RunnerResource(UpdateRunner::run(Actor::fromRequest($request), $runner, $request->all())->load('busyRuns'));
    }

    /**
     * Revoke a runner.
     *
     * `{canceled}`: its token stops working at once, what runs on it ends as canceled.
     */
    #[Answer(200, AgentSchemas::class, 'revoked', 'How many runs the revocation canceled.')]
    public function destroy(Request $request, Runner $runner): JsonResponse
    {
        return response()->json(['canceled' => RevokeRunner::run(Actor::fromRequest($request), $runner)]);
    }
}
