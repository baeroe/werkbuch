<?php

use App\Domain\Accounts\Handle;

it('validates handles', function (string $handle, bool $valid) {
    expect(Handle::isValid($handle))->toBe($valid);
})->with([
    ['mara', true], ['jo-2', true], ['abc', true], [str_repeat('a', 32), true],
    ['ab', false], ["abc\n", false], ['Mara', false], ['mara_l', false], ['ma ra', false], [str_repeat('a', 33), false], ['', false],
]);

it('suggests a handle from an email address', function (string $source, string $handle) {
    expect(Handle::suggest($source, fn () => false))->toBe($handle);
})->with([
    ['mara@feldwerk.example.com', 'mara'], ['Jörg.Müßig@example.com', 'joerg-muessig'], ['jo@example.com', 'jo-user'],
    ['--a__b--@example.com', 'a-b'], [str_repeat('x', 40).'@example.com', str_repeat('x', 32)],
    ['Mara Feldwerk', 'mara-feldwerk'], ['@example.com', 'user'], ['___@example.com', 'user'],
    [str_repeat('x', 31).'-yy@example.com', str_repeat('x', 31)],
]);

it('appends a number while the handle is taken', function () {
    $taken = ['automation', 'automation-2'];
    expect(Handle::suggest('automation@example.com', fn (string $h) => in_array($h, $taken, true)))->toBe('automation-3')
        ->and(strlen(Handle::suggest(str_repeat('y', 32).'@x.de', fn (string $h) => $h === str_repeat('y', 32))))->toBe(32);
});

it('keeps suggestions valid when the number needs the room of the stem', function () {
    $stem = str_repeat('a', 30).'-b';
    $suggestion = Handle::suggest($stem.'@example.com', fn (string $h) => $h === $stem);

    expect($suggestion)->toBe(str_repeat('a', 30).'-2')->and(Handle::isValid($suggestion))->toBeTrue();
});
