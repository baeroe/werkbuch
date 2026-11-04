<?php

use App\Domain\Wiki\PageTree;

$tree = fn (): PageTree => new PageTree([
    'a' => null,
    'b' => 'a',
    'c' => 'a',
    'd' => 'b',
    'e' => null,
]);

it('lists a page with its subtree, the page first', function () use ($tree) {
    expect($tree()->subtree('a'))->toBe(['a', 'b', 'c', 'd'])
        ->and($tree()->subtree('b'))->toBe(['b', 'd'])
        ->and($tree()->subtree('e'))->toBe(['e']);
});

it('gives an empty subtree for an unknown page', function () use ($tree) {
    expect($tree()->subtree('zzz'))->toBe([]);
});

it('finds a move into the page itself or below it', function () use ($tree) {
    expect($tree()->wouldCycle('a', 'a'))->toBeTrue()
        ->and($tree()->wouldCycle('a', 'd'))->toBeTrue()
        ->and($tree()->wouldCycle('b', 'c'))->toBeFalse()
        ->and($tree()->wouldCycle('d', null))->toBeFalse()
        ->and($tree()->wouldCycle('d', 'e'))->toBeFalse();
});

it('never loops on a broken tree', function () {
    $broken = new PageTree(['b' => 'c', 'c' => 'b', 'x' => null]);

    expect($broken->subtree('b'))->toBe(['b', 'c'])
        ->and($broken->wouldCycle('x', 'b'))->toBeTrue();
});
