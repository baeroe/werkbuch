<?php

use App\Support\ResponseExcerpt;

it('keeps a short answer as it is', function () {
    expect(ResponseExcerpt::MAX_BYTES)->toBe(2048)
        ->and(ResponseExcerpt::of('ok'))->toBe('ok')
        ->and(ResponseExcerpt::of(str_repeat('a', 2048)))->toBe(str_repeat('a', 2048));
});

it('has no excerpt without an answer or for an empty one', function () {
    expect(ResponseExcerpt::of(null))->toBeNull()
        ->and(ResponseExcerpt::of(''))->toBeNull();
});

it('cuts at 2 KB without breaking a character', function () {
    // 2049 bytes: one byte, then two-byte characters; the last one would end after byte 2048
    $excerpt = ResponseExcerpt::of('a'.str_repeat('ä', 1024));

    expect(strlen((string) $excerpt))->toBe(2047)
        ->and(mb_check_encoding((string) $excerpt, 'UTF-8'))->toBeTrue()
        ->and(ResponseExcerpt::of(str_repeat('ä', 1500)))->toBe(str_repeat('ä', 1024));
});

it('stores an answer that is no UTF-8 as valid text', function () {
    $excerpt = ResponseExcerpt::of("ok\xff\xfe".str_repeat('x', 3000));

    expect(mb_check_encoding((string) $excerpt, 'UTF-8'))->toBeTrue()
        ->and(strlen((string) $excerpt))->toBeLessThanOrEqual(2048)
        ->and($excerpt)->toStartWith('ok');
});

it('names a packed answer instead of keeping its bytes (T8-M1)', function () {
    $packed = (string) gzencode(str_repeat('{"ok":true}', 500));

    expect(ResponseExcerpt::of($packed, 'gzip'))->toBe('(gzip, '.strlen($packed).' bytes)')
        ->and(ResponseExcerpt::of('abc', ' BR '))->toBe('(br, 3 bytes)')
        ->and(ResponseExcerpt::of('ok', 'identity'))->toBe('ok')
        ->and(ResponseExcerpt::of('ok', ''))->toBe('ok')
        ->and(ResponseExcerpt::of('', 'gzip'))->toBeNull();
});

it('keeps an encoding name a receiver made up to a short token', function () {
    expect(ResponseExcerpt::of('x', "gz\u{0007}ip;".str_repeat('a', 100)))->toBe('(gzip'.str_repeat('a', 26).', 1 bytes)')
        ->and(ResponseExcerpt::of('x', ';;'))->toBe('(unknown, 1 bytes)');
});
