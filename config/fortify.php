<?php

use Laravel\Fortify\Features;

// Sign-in, sign-out and password reset (App\Providers\FortifyServiceProvider binds the Inertia pages and the actions).
// Registration, profile, two-factor and passkeys stay off: accounts come from invitations and app:ensure-admin.
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
    ],

    // the GET routes render the Inertia pages
    'views' => true,

    'features' => [
        Features::resetPasswords(),
    ],

];
