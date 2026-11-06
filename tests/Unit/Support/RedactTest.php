<?php

use App\Support\Redact;

it('masks user, password, query and fragment of every URL', function () {
    $text = 'cURL error 6: Could not resolve host: receiver.example.com for https://user:pw@receiver.example.com:8443/hook?token=geheim#part and http://other.example.com/a?b=c';

    expect(Redact::text($text))->toBe('cURL error 6: Could not resolve host: receiver.example.com for https://…@receiver.example.com:8443/hook?… and http://other.example.com/a?…');
});

it('leaves a URL without user and query as it is', function () {
    $text = 'cURL error 28: Operation timed out after 10001 milliseconds with 0 bytes received (see https://curl.haxx.se/libcurl/c/libcurl-errors.html) for https://receiver.example.com/hook';

    expect(Redact::text($text))->toBe($text);
});

it('keeps the first sentence only', function () {
    expect(Redact::text('Webhook call failed. Then something else. And more.'))->toBe('Webhook call failed.')
        ->and(Redact::text("Line one\nline two"))->toBe('Line one');
});

it('keeps at most 300 characters', function () {
    $text = Redact::text(str_repeat('ä', 400));

    expect(mb_strlen($text))->toBe(300)
        ->and(Redact::MAX)->toBe(300);
});
