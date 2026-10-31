<?php

namespace App\Auth;

use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

/**
 * The answer to a wrong code at the two-factor challenge (App\Http\Controllers\Auth\TwoFactorChallengeController): back
 * to the challenge, the error at the field that was used (the code of the app or a recovery code).
 */
final class FailedTwoFactorLogin
{
    /**
     * @param  Request  $request
     */
    public function toResponse($request): RedirectResponse
    {
        $error = $request->filled('recovery_code')
            ? ['recovery_code' => __('two_factor_challenge.recovery_code_wrong')]
            : ['code' => __('field.code.wrong')];

        return redirect()->route('two-factor.login')->withErrors($error);
    }
}
