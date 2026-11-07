<?php

// English messages of Laravel's auth group (keys as in the framework; tests/Unit/FrameworkTranslationsTest.php keeps them in step).
return [
    'failed' => 'Email or password is not correct.',
    'password' => 'The password is not correct.',
    'throttle' => 'Too many attempts. Try again in :seconds seconds.',
    // the app's own: a wait from two minutes on (the cap per account of the sign-in, A434)
    'throttle_minutes' => 'Too many sign-in attempts. Try again in :minutes minutes.',
];
