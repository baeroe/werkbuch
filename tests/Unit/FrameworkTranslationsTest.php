<?php

/**
 * The messages of a PHP language group as flat "a.b.c" => text, without the app-owned custom and attributes.
 *
 * @param  array<string, mixed>  $lines
 * @return array<string, string>
 */
function groupMessages(array $lines, string $prefix = ''): array
{
    $messages = [];

    foreach ($lines as $key => $value) {
        if ($prefix === '' && in_array($key, ['custom', 'attributes'], true)) {
            continue;
        }

        $messages = is_array($value) ? [...$messages, ...groupMessages($value, "{$prefix}{$key}.")] : [...$messages, "{$prefix}{$key}" => $value];
    }

    return $messages;
}

$framework = fn (string $group): array => groupMessages(require repo_path("vendor/laravel/framework/src/Illuminate/Translation/lang/en/{$group}.php"));

// messages the app adds to a framework group (the wait in minutes of the cap per account, A434); every other key follows Laravel
$own = ['auth' => ['throttle_minutes']];

/** The messages of the app in a language and group, without the ones the app adds itself. */
$app = fn (string $locale, string $group): array => array_diff_key(groupMessages(require repo_path("lang/{$locale}/{$group}.php")), array_flip($own[$group] ?? []));

it('has a German text for every message of Laravel, with the same placeholders', function (string $group) use ($framework, $app) {
    $en = $framework($group);
    $de = $app('de', $group);

    expect(array_diff_key($en, $de))->toBe([], "missing in lang/de/{$group}.php")
        ->and(array_diff_key($de, $en))->toBe([], "unknown in lang/de/{$group}.php");

    foreach ($en as $key => $text) {
        expect(placeholders($de[$key]))->toBe(placeholders($text), "{$group}.{$key}");
    }
})->with(['validation', 'pagination', 'auth', 'passwords']);

it('words the English auth and passwords messages of the app with the placeholders of Laravel', function (string $group) use ($framework, $app) {
    $framework = $framework($group);
    $en = $app('en', $group);

    expect(array_keys($en))->toBe(array_keys($framework));

    foreach ($framework as $key => $text) {
        expect(placeholders($en[$key]))->toBe(placeholders($text), "{$group}.{$key}");
    }
})->with(['auth', 'passwords']);

it('has the messages the app adds to a framework group in both languages, with the same placeholders', function () use ($own) {
    foreach ($own as $group => $keys) {
        $en = groupMessages(require repo_path("lang/en/{$group}.php"));
        $de = groupMessages(require repo_path("lang/de/{$group}.php"));

        foreach ($keys as $key) {
            expect($en)->toHaveKey($key, message: "lang/en/{$group}.php");
            expect($de)->toHaveKey($key, message: "lang/de/{$group}.php");
            expect(placeholders($de[$key]))->toBe(placeholders($en[$key]), "{$group}.{$key}");
        }
    }

    expect(placeholders(groupMessages(require repo_path('lang/en/auth.php'))['throttle_minutes']))->toBe([':minutes']);
});

it('names the account fields in German', function () {
    $attributes = (require repo_path('lang/de/validation.php'))['attributes'];

    expect($attributes)->toMatchArray(['email' => 'E-Mail', 'password' => 'Passwort', 'name' => 'Name']);
});

it('words the throttled and unknown-address answers like the ones that reveal nothing', function (string $locale) {
    $passwords = require repo_path("lang/{$locale}/passwords.php");

    expect($passwords['throttled'])->toBe($passwords['sent'])
        ->and($passwords['user'])->toBe($passwords['token']);
})->with(['en', 'de']);
