<?php

use App\Support\ClientKeys;

it('names a row by its id, and one without by its index', function () {
    expect(ClientKeys::keyOf(['id' => 'st_a'], 0))->toBe('st_a')
        ->and(ClientKeys::keyOf(['id' => '01hzy3k2m5b7q8r9s0t1v2w3x4'], 3))->toBe('01hzy3k2m5b7q8r9s0t1v2w3x4')
        ->and(ClientKeys::keyOf([], 2))->toBe('new:2')
        // a missing id and a null id are the same thing
        ->and(ClientKeys::keyOf(['id' => null], 5))->toBe('new:5')
        ->and(ClientKeys::keyOf([], 0))->toStartWith(ClientKeys::PREFIX);
});

it('resolves a key to the ULID of its row', function () {
    $own = ['01hzy3k2m5b7q8r9s0t1v2w3x4', '01hzy3k2m5b7q8r9s0t1v2w3x5'];
    $ids = ['st_a' => '01hzy3k2m5b7q8r9s0t1v2w3x6', 'new:1' => '01hzy3k2m5b7q8r9s0t1v2w3x7', '01hzy3k2m5b7q8r9s0t1v2w3x4' => '01hzy3k2m5b7q8r9s0t1v2w3x4'];

    expect(ClientKeys::resolve($own, $ids, '01hzy3k2m5b7q8r9s0t1v2w3x5'))->toBe('01hzy3k2m5b7q8r9s0t1v2w3x5')
        ->and(ClientKeys::resolve($own, $ids, 'st_a'))->toBe('01hzy3k2m5b7q8r9s0t1v2w3x6')
        ->and(ClientKeys::resolve($own, $ids, 'new:1'))->toBe('01hzy3k2m5b7q8r9s0t1v2w3x7')
        // before anything is written only the own rows are known
        ->and(ClientKeys::resolve($own, [], '01hzy3k2m5b7q8r9s0t1v2w3x4'))->toBe('01hzy3k2m5b7q8r9s0t1v2w3x4')
        ->and(ClientKeys::resolve($own, [], 'st_a'))->toBeNull()
        // the ULID of a row of another entry is no row of this one
        ->and(ClientKeys::resolve($own, [], '01hzy3k2m5b7q8r9s0t1v2w3x9'))->toBeNull();
});
