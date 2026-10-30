<?php

namespace App\Http\Controllers\Api;

use App\Actions\Account\ChangePassword;
use App\Http\Controllers\Controller;
use App\Support\Actor;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * The own password (only from the session, EnsureSession).
 */
final class PasswordController extends Controller
{
    public function update(Request $request): Response
    {
        ChangePassword::run(Actor::fromRequest($request), $request->all());

        return response()->noContent();
    }
}
