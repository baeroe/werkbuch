<?php

// English messages of Laravel's passwords group (keys as in the framework; tests/Unit/FrameworkTranslationsTest.php keeps them in step).
// `throttled` reads like `sent`, and `user` like `token`: the password broker returns the throttle only for an existing
// account, and `user` for an unknown address, so different texts would reveal whether an account exists.
return [
    'reset' => 'Your password is set. Sign in with it.',
    'sent' => 'If the address belongs to an account, a link to reset the password is on its way.',
    'throttled' => 'If the address belongs to an account, a link to reset the password is on its way.',
    'token' => 'This link has expired or was already used. Request a new one.',
    'user' => 'This link has expired or was already used. Request a new one.',
];
