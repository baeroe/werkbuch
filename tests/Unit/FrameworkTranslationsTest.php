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

it('has a German text for every message of Laravel, with the same placeholders', function (string $group) use ($framework) {
    $en = $framework($group);
    $de = groupMessages(require repo_path("lang/de/{$group}.php"));

    expect(array_diff_key($en, $de))->toBe([], "missing in lang/de/{$group}.php")
        ->and(array_diff_key($de, $en))->toBe([], "unknown in lang/de/{$group}.php");

    foreach ($en as $key => $text) {
        expect(placeholders($de[$key]))->toBe(placeholders($text), "{$group}.{$key}");
    }
})->with(['validation', 'pagination', 'auth', 'passwords']);

it('words the English auth and passwords messages of the app with the placeholders of Laravel', function (string $group) use ($framework) {
    $framework = $framework($group);
    $en = groupMessages(require repo_path("lang/en/{$group}.php"));

    expect(array_keys($en))->toBe(array_keys($framework));

    foreach ($framework as $key => $text) {
        expect(placeholders($en[$key]))->toBe(placeholders($text), "{$group}.{$key}");
    }
})->with(['auth', 'passwords']);

it('names the account fields in German', function () {
    $attributes = (require repo_path('lang/de/validation.php'))['attributes'];

    expect($attributes)->toMatchArray(['email' => 'E-Mail', 'password' => 'Passwort', 'name' => 'Name']);
});

it('words the throttled and unknown-address answers like the ones that reveal nothing', function (string $locale) {
    $passwords = require repo_path("lang/{$locale}/passwords.php");

    expect($passwords['throttled'])->toBe($passwords['sent'])
        ->and($passwords['user'])->toBe($passwords['token']);
})->with(['en', 'de']);
