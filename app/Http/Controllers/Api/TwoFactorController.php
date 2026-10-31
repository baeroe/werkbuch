<?php

namespace App\Http\Controllers\Api;

use App\Actions\Account\ConfirmTwoFactor;
use App\Actions\Account\DisableTwoFactor;
use App\Actions\Account\EnableTwoFactor;
use App\Actions\Account\GetTwoFactor;
use App\Actions\Account\RegenerateRecoveryCodes;
use App\Http\Controllers\Controller;
use App\Support\Actor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * The own second factor (only from the session, EnsureSession): its state, the setup in two steps, off, new recovery
 * codes. The answers are plain objects, no resources.
 */
final class TwoFactorController extends Controller
{
    public function show(Request $request): JsonResponse
    {
        return response()->json(GetTwoFactor::run(Actor::fromRequest($request)));
    }

    public function store(Request $request): JsonResponse
    {
        return response()->json(EnableTwoFactor::run(Actor::fromRequest($request)));
    }

    public function confirm(Request $request): JsonResponse
    {
        $code = $request->input('code');

        // anything but a text is a wrong code; the action names the field
        return response()->json(ConfirmTwoFactor::run(Actor::fromRequest($request), is_string($code) ? $code : ''));
    }

    public function destroy(Request $request): Response
    {
        DisableTwoFactor::run(Actor::fromRequest($request), $request->boolean('unconfirmed'));

        return response()->noContent();
    }

    public function recoveryCodes(Request $request): JsonResponse
    {
        return response()->json(RegenerateRecoveryCodes::run(Actor::fromRequest($request)));
    }
}
