<?php

// German messages of Laravel's auth group (keys as in the framework; tests/Unit/FrameworkTranslationsTest.php keeps them in step).
return [
    'failed' => 'E-Mail oder Passwort stimmen nicht.',
    'password' => 'Das Passwort stimmt nicht.',
    'throttle' => 'Zu viele Versuche. Versuch es in :seconds Sekunden wieder.',
    // the app's own: a wait from two minutes on (the cap per account of the sign-in, A434)
    'throttle_minutes' => 'Zu viele Anmeldeversuche. Versuch es in :minutes Minuten wieder.',
];
