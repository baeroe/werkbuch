<?php

use Laravel\Fortify\Features;

// Sign-in with an optional second factor (TOTP, recovery codes), sign-out and password reset
// (App\Providers\FortifyServiceProvider binds the Inertia pages and the actions). Registration, profile and passkeys
// stay off: accounts come from invitations and app:ensure-admin.
return [

    'guard' => 'web',

    'passwords' => 'users',

    'username' => 'email',

    'email' => 'email',

    // the address is compared in lower case (sign-in, reset link, reset)
    'lowercase_usernames' => true,

    'home' => '/my-items',

    'redirects' => [
        'logout' => '/login',
    ],

    'prefix' => '',

    'domain' => null,

    'middleware' => ['web'],

    // `login` is the limit per IP (FortifyServiceProvider); the lock after five failures per lower(email)|IP comes from
    // Fortify's LoginRateLimiter in the sign-in pipeline
    'limiters' => [
        'login' => 'login',
        'two-factor' => 'two-factor',
    ],

    // the GET routes render the Inertia pages
    'views' => true,

    'features' => [
        Features::resetPasswords(),
        // set up in the personal settings over /api/v1/me/two-factor (App\Actions\Account): on only after the first code,
        // without asking for the password again (P19: only from the session, the confirmation is limited)
        Features::twoFactorAuthentication(['confirm' => true, 'confirmPassword' => false]),
    ],

];
