<?php

namespace App\Http\Controllers\Api;

use App\Actions\Account\ConfirmTwoFactor;
use App\Actions\Account\DisableTwoFactor;
use App\Actions\Account\EnableTwoFactor;
use App\Actions\Account\GetTwoFactor;
use App\Actions\Account\RegenerateRecoveryCodes;
use App\Http\Api\Answer;
use App\Http\Api\Body;
use App\Http\Controllers\Controller;
use App\OpenApi\AccountSchemas;
use App\Support\Actor;
use Dedoc\Scramble\Attributes\QueryParameter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * The own second factor (only from the session, EnsureSession): its state, the setup in two steps, off, new recovery
 * codes. The answers are plain objects, no resources.
 */
final class TwoFactorController extends Controller
{
    /**
     * The state of the second factor.
     */
    #[Answer(200, AccountSchemas::class, 'twoFactorState', 'The state of the second factor.')]
    public function show(Request $request): JsonResponse
    {
        return response()->json(GetTwoFactor::run(Actor::fromRequest($request)));
    }

    /**
     * Start the setup of the second factor (session only).
     */
    #[Answer(200, AccountSchemas::class, 'twoFactorSetup', 'The secret, its address and its QR code, shown once.')]
    public function store(Request $request): JsonResponse
    {
        return response()->json(EnableTwoFactor::run(Actor::fromRequest($request)));
    }

    /**
     * Turn the second factor on with the first code.
     *
     * A wrong code (422 at `code`) keeps the setup open.
     */
    #[Body(AccountSchemas::class, 'code')]
    #[Answer(200, AccountSchemas::class, 'recoveryCodes', 'The recovery codes, shown once.')]
    public function confirm(Request $request): JsonResponse
    {
        $code = $request->input('code');

        // anything but a text is a wrong code; the action names the field
        return response()->json(ConfirmTwoFactor::run(Actor::fromRequest($request), is_string($code) ? $code : ''));
    }

    /**
     * Turn the second factor off, or cancel a setup that was not confirmed.
     */
    #[QueryParameter('unconfirmed', 'Only cancel a setup that was not confirmed (`1`); a second factor that was confirmed in the meantime stays on.', type: 'boolean', default: false)]
    public function destroy(Request $request): Response
    {
        DisableTwoFactor::run(Actor::fromRequest($request), $request->boolean('unconfirmed'));

        return response()->noContent();
    }

    /**
     * Make new recovery codes; the old ones stop working.
     */
    #[Answer(200, AccountSchemas::class, 'recoveryCodes', 'The new recovery codes, shown once.')]
    public function recoveryCodes(Request $request): JsonResponse
    {
        return response()->json(RegenerateRecoveryCodes::run(Actor::fromRequest($request)));
    }
}
