<?php

namespace App\Http\Controllers;

use App\Actions\AgentRuns\ClaimRun;
use App\Actions\AgentRuns\FinishRun;
use App\Actions\AgentRuns\RecordHeartbeat;
use App\Actions\AgentRuns\RecordRunEvents;
use App\Actions\AgentRuns\RenewGitToken;
use App\Actions\Auth\PairRunner;
use App\Http\Api\RunnerKey;
use App\Models\Runner;
use App\Models\User;
use App\Support\Actor;
use App\Support\RunnerProtocol;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The runner protocol under /api/runner (spec 6, A487): not part of /api/v1, the OpenAPI document or MCP. Every request
 * names its version and protocol in headers (`X-Werkbuch-Runner-Version`, `X-Werkbuch-Protocol`), every answer the
 * places of the runner and the version werkbuch expects. The runner is no account: the actions run as the system.
 */
final class RunnerProtocolController extends Controller
{
    /** Redeems a one-time code: 201 `{runner: {id, name}, token, places, version, protocol}`. */
    public function pair(Request $request): JsonResponse
    {
        $paired = PairRunner::run([...$request->all(), 'protocol' => $request->header('X-Werkbuch-Protocol')]);

        return response()->json([
            'runner' => ['id' => $paired['runner']->id, 'name' => $paired['runner']->name],
            'token' => $paired['token'],
            ...RunnerProtocol::answer($paired['runner']),
        ], 201);
    }

    /** Asks for work with the report of the runner: `{run, places, version, protocol}`, `run` null without one. */
    public function claim(Request $request): JsonResponse
    {
        return response()->json(ClaimRun::run(self::actor(), self::runner($request), [...$request->all(), ...self::headers($request)]));
    }

    public function heartbeat(Request $request, string $runId): JsonResponse
    {
        return response()->json(RecordHeartbeat::run(self::actor(), self::runner($request), $runId, [...$request->all(), ...self::headers($request)]));
    }

    public function events(Request $request, string $runId): JsonResponse
    {
        return response()->json(RecordRunEvents::run(self::actor(), self::runner($request), $runId, [...$request->all(), ...self::headers($request)]));
    }

    public function result(Request $request, string $runId): JsonResponse
    {
        $run = FinishRun::run(self::actor(), self::runner($request), $runId, [...$request->all(), ...self::headers($request)]);

        return response()->json(['run' => ['id' => $run->id, 'status' => $run->status->value]]);
    }

    /** A new installation token for a running run: `{git: {repo_url, token, expires_at}, places, …}`. */
    public function gitToken(Request $request, string $runId): JsonResponse
    {
        return response()->json(RenewGitToken::run(self::actor(), self::runner($request), $runId, [...$request->all(), ...self::headers($request)]));
    }

    /**
     * @return array{version: mixed, protocol: mixed}
     */
    private static function headers(Request $request): array
    {
        return ['version' => $request->header('X-Werkbuch-Runner-Version'), 'protocol' => $request->header('X-Werkbuch-Protocol')];
    }

    private static function actor(): Actor
    {
        return Actor::system(User::defaultBot(), 'runner');
    }

    /** The runner AuthenticateRunner let through. */
    private static function runner(Request $request): Runner
    {
        /** @var Runner */
        return RunnerKey::runner($request);
    }
}
