<?php

namespace App\Http\Controllers\Api;

use App\Actions\Runners\CreatePairingCode;
use App\Actions\Runners\GetPairingCode;
use App\Http\Controllers\Controller;
use App\Http\Resources\RunnerPairingResource;
use App\Models\RunnerPairingCode;
use App\Support\Actor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * One-time codes to pair runners (spec 6.2): only from the session of the interface (a code is as good as a token).
 */
final class RunnerPairingsController extends Controller
{
    /**
     * Make a one-time code for a runner.
     *
     * 201: the code and the command that installs a runner with it, valid ten minutes and redeemed once; shown once. Codes not redeemed yet stop working.
     */
    public function store(Request $request): JsonResponse
    {
        $made = CreatePairingCode::run(Actor::fromRequest($request));
        $made['pairing']->plain = $made['code'];

        return (new RunnerPairingResource($made['pairing']))->response()->setStatusCode(201);
    }

    /**
     * Read a one-time code.
     *
     * Without its code: whether a runner redeemed it, and which.
     */
    public function show(Request $request, RunnerPairingCode $pairing): RunnerPairingResource
    {
        return new RunnerPairingResource(GetPairingCode::run(Actor::fromRequest($request), $pairing));
    }
}
