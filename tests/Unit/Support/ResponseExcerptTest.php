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
