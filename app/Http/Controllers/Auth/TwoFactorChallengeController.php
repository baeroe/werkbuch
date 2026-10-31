<?php

namespace App\Http\Controllers\Auth;

use App\Actions\Auth\FindChallengedUser;
use App\Actions\Auth\PassTwoFactorChallenge;
use App\Auth\FailedTwoFactorLogin;
use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Contracts\Auth\StatefulGuard;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;
use Laravel\Fortify\Fortify;
use Symfony\Component\HttpFoundation\Response as HttpResponse;

/**
 * The second step of signing in, after the password (Fortify's pipeline started it: `login.id`, `login.remember` and the
 * password stamp in the session). Without a started sign-in it leads to the sign-in; with one that no longer counts
 * (FindChallengedUser) it says so there.
 */
final class TwoFactorChallengeController extends Controller
{
    public function __construct(private readonly StatefulGuard $guard) {}

    public function create(Request $request): Response|RedirectResponse
    {
        if (! $request->session()->has('login.id')) {
            return redirect()->route('login');
        }

        if (self::challenged($request) === null) {
            return self::startAgain($request);
        }

        return Inertia::render('Auth/TwoFactorChallenge');
    }

    public function store(Request $request): HttpResponse
    {
        $user = self::challenged($request);

        if ($user === null) {
            return self::startAgain($request);
        }

        $code = $request->input('code');
        $recoveryCode = $request->input('recovery_code');

        if (! PassTwoFactorChallenge::run($user, is_string($code) ? $code : null, is_string($recoveryCode) ? $recoveryCode : null)) {
            return (new FailedTwoFactorLogin)->toResponse($request);
        }

        $remember = (bool) $request->session()->pull('login.remember', false);
        $request->session()->forget(['login.id', 'login.password']);
        $this->guard->login($user, $remember);
        $request->session()->regenerate();

        return redirect()->intended(Fortify::redirects('login'));
    }

    private static function challenged(Request $request): ?User
    {
        return FindChallengedUser::run($request->session()->get('login.id'), $request->session()->get('login.password'));
    }

    private static function startAgain(Request $request): RedirectResponse
    {
        $request->session()->forget(['login.id', 'login.remember', 'login.password']);

        return redirect()->route('login')->with('error', __('two_factor_challenge.expired'));
    }
}
