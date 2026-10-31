<?php

namespace App\Auth;

use App\Actions\Auth\FindChallengedUser;
use App\Models\User;
use Illuminate\Http\Request;
use Laravel\Fortify\Actions\RedirectIfTwoFactorAuthenticatable;
use Symfony\Component\HttpFoundation\Response;

/**
 * Fortify's step of the sign-in that leads people with a second factor to the challenge, which also notes a stamp of the
 * password next to `login.id`: a challenge started before the password changed no longer counts (FindChallengedUser).
 */
final class RedirectToTwoFactorChallenge extends RedirectIfTwoFactorAuthenticatable
{
    /**
     * @param  Request  $request
     * @param  User  $user
     */
    protected function twoFactorChallengeResponse($request, $user): Response
    {
        $request->session()->put('login.password', FindChallengedUser::passwordStamp($user));

        return parent::twoFactorChallengeResponse($request, $user);
    }
}
