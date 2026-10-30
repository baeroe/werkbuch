<?php

// German messages of Laravel's passwords group (keys as in the framework; tests/Unit/FrameworkTranslationsTest.php keeps them in step).
// `throttled` reads like `sent`, and `user` like `token`: the password broker returns the throttle only for an existing
// account, and `user` for an unknown address, so different texts would reveal whether an account exists.
return [
    'reset' => 'Dein Passwort ist gesetzt. Melde dich damit an.',
    'sent' => 'Gehört die Adresse zu einem Konto, ist ein Link zum Zurücksetzen des Passworts unterwegs.',
    'throttled' => 'Gehört die Adresse zu einem Konto, ist ein Link zum Zurücksetzen des Passworts unterwegs.',
    'token' => 'Dieser Link ist abgelaufen oder wurde schon benutzt. Fordere einen neuen an.',
    'user' => 'Dieser Link ist abgelaufen oder wurde schon benutzt. Fordere einen neuen an.',
];
