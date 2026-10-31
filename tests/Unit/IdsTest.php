<?php

use App\Support\Ids;

it('lowercases a ULID', function () {
    expect(Ids::normalize('01JBXYZ0ABCDEFGHJKMNPQRSTV'))->toBe('01jbxyz0abcdefghjkmnpqrstv');
});

it('leaves a local id as it came', function () {
    expect(Ids::normalize('st_ABC'))->toBe('st_ABC')
        ->and(Ids::normalize('01JBXYZ0ABCDEFGHJKMNPQRSTV0'))->toBe('01JBXYZ0ABCDEFGHJKMNPQRSTV0'); // 27 characters
});

it('goes through a list element by element', function () {
    expect(Ids::normalize(['01JBXYZ0ABCDEFGHJKMNPQRSTV', 'x']))->toBe(['01jbxyz0abcdefghjkmnpqrstv', 'x']);
});

it('goes through the keys and the values of a map', function () {
    expect(Ids::normalize(['01JBXYZ0ABCDEFGHJKMNPQRSTV' => '01JCXYZ0ABCDEFGHJKMNPQRSTV', 'st_ABC' => 'st_DEF']))
        ->toBe(['01jbxyz0abcdefghjkmnpqrstv' => '01jcxyz0abcdefghjkmnpqrstv', 'st_ABC' => 'st_DEF']);
});

it('goes through nested maps and keeps numbers, null and booleans', function () {
    expect(Ids::normalize(['a' => ['01JBXYZ0ABCDEFGHJKMNPQRSTV']]))->toBe(['a' => ['01jbxyz0abcdefghjkmnpqrstv']])
        ->and(Ids::normalize(7))->toBe(7)
        ->and(Ids::normalize(null))->toBeNull()
        ->and(Ids::normalize(true))->toBeTrue();
});
