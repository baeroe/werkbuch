<?php

use App\Domain\Ranking\Rank;

/**
 * @return array{between: list<array{0: ?string, 1: ?string, 2: string}>, nBetween: list<array{0: ?string, 1: ?string, 2: int, 3: list<string>}>, invalid: list<string>}
 */
$fixtures = fn (): array => json_decode((string) file_get_contents(repo_path('tests/Support/rank-fixtures.json')), true, flags: JSON_THROW_ON_ERROR);

/** mulberry32, as in the clickdummy's rank.test.ts: the same "random" spots on every run. */
$seededRandom = function (int $seed): Closure {
    $state = $seed;
    $int32 = fn (int $value): int => ($value & 0xFFFFFFFF) >= 0x80000000 ? ($value & 0xFFFFFFFF) - 0x100000000 : $value & 0xFFFFFFFF;
    // Math.imul: the low 32 bits of the product, in halves so that nothing overflows into a float
    $imul = fn (int $a, int $b): int => $int32(($a & 0xFFFFFFFF) * ($b & 0xFFFF) + (((($a & 0xFFFFFFFF) * (($b >> 16) & 0xFFFF)) & 0xFFFF) << 16));
    $shr = fn (int $value, int $bits): int => ($value & 0xFFFFFFFF) >> $bits;

    return function () use (&$state, $int32, $imul, $shr): float {
        $state = $int32($state + 0x6D2B79F5);
        $t = $imul($state ^ $shr($state, 15), 1 | $state);
        $t = $int32($int32($t + $imul($t ^ $shr($t, 7), 61 | $t)) ^ $t);

        return ($int32($t ^ $shr($t, 14)) & 0xFFFFFFFF) / 4294967296;
    };
};

it('matches fractional-indexing for every case of the fixture', function () use ($fixtures) {
    $cases = $fixtures();

    foreach ($cases['between'] as [$before, $after, $result]) {
        expect(Rank::between($before, $after))->toBe($result, "between({$before}, {$after})");
    }
    foreach ($cases['nBetween'] as [$before, $after, $n, $results]) {
        expect(Rank::nBetween($before, $after, $n))->toBe($results, "nBetween({$before}, {$after}, {$n})");
    }
    foreach ($cases['invalid'] as $key) {
        expect(Rank::isValid($key))->toBeFalse("isValid('{$key}')")
            ->and(fn () => Rank::between($key, null))->toThrow(InvalidArgumentException::class);
    }

    expect($cases['between'])->toHaveCount(319)
        ->and($cases['nBetween'])->toHaveCount(12)
        ->and($cases['invalid'])->toHaveCount(5);
});

it('50 random inserts between neighbours stay strictly sorted and unique', function () use ($seededRandom) {
    $random = $seededRandom(2026);
    $ranks = [];

    for ($i = 0; $i < 50; $i++) {
        $at = (int) floor($random() * (count($ranks) + 1));
        $before = $at > 0 ? $ranks[$at - 1] : null;
        $after = $at < count($ranks) ? $ranks[$at] : null;
        $rank = Rank::between($before, $after);

        // the new rank lies strictly between its neighbours ...
        if ($before !== null) {
            expect(strcmp($rank, $before))->toBeGreaterThan(0);
        }
        if ($after !== null) {
            expect(strcmp($rank, $after))->toBeLessThan(0);
        }
        array_splice($ranks, $at, 0, [$rank]);
    }

    // ... so the whole list is strictly increasing and has no duplicates
    for ($i = 1; $i < count($ranks); $i++) {
        expect(strcmp($ranks[$i], $ranks[$i - 1]))->toBeGreaterThan(0);
    }
    expect(array_unique($ranks))->toHaveCount(50);
});

it('draws the same spots as the clickdummy generator', function () use ($seededRandom) {
    // the first values of mulberry32(2026) in JavaScript, so the test above inserts where rank.test.ts does
    $random = $seededRandom(2026);

    expect(array_map(fn () => (int) floor($random() * 1000), range(1, 5)))->toBe([455, 308, 661, 618, 152]);
});

it('gives a first rank for an empty list', function () {
    expect(Rank::between(null, null))->toBe('a0');
});

it('sorts after the last and before the first rank', function () {
    $middle = Rank::between(null, null);

    expect(strcmp(Rank::between($middle, null), $middle))->toBeGreaterThan(0)
        ->and(strcmp(Rank::between(null, $middle), $middle))->toBeLessThan(0);
});

it('keeps working when items are always inserted at the same spot', function () {
    $before = Rank::between(null, null);
    $after = Rank::between($before, null);
    $seen = [$before => true, $after => true];

    for ($i = 0; $i < 30; $i++) {
        $next = Rank::between($before, $after);
        expect(strcmp($next, $before) > 0 && strcmp($next, $after) < 0)->toBeTrue()
            ->and(isset($seen[$next]))->toBeFalse();
        $seen[$next] = true;
        $before = $next;
    }
});

it('refuses two neighbours with the same rank', function () {
    expect(fn () => Rank::between('a0', 'a0'))->toThrow(InvalidArgumentException::class, 'a0');
});

it('refuses neighbours in the wrong order, which fractional-indexing would swap', function () {
    expect(fn () => Rank::between('a1', 'a0'))->toThrow(InvalidArgumentException::class, 'a1')
        ->and(fn () => Rank::nBetween('a1', 'a0', 2))->toThrow(InvalidArgumentException::class);
});

it('sorts by bytes, not by letters', function () {
    // upper case sorts before lower case: a comparison that ignores case would put "Zz" after "a0"
    expect(strcmp('Zz', 'a0'))->toBeLessThan(0)
        ->and(strcasecmp('Zz', 'a0'))->toBeGreaterThan(0);

    $rank = Rank::between('Zz', 'a0');

    expect($rank)->toBe('ZzV')
        ->and(strcmp('Zz', $rank))->toBeLessThan(0)
        ->and(strcmp($rank, 'a0'))->toBeLessThan(0);
});

it('accepts only keys of the 62 digits', function () {
    expect(Rank::isValid('a0'))->toBeTrue()
        ->and(Rank::isValid('Zz'))->toBeTrue()
        ->and(Rank::isValid('a0V'))->toBeTrue()
        // fractional-indexing reads a blank or an umlaut as a digit and accepts these; ranks are ASCII digits only
        ->and(Rank::isValid('a0 '))->toBeFalse()
        ->and(Rank::isValid('a0ä'))->toBeFalse()
        ->and(Rank::isValid('a!'))->toBeFalse()
        // a head that is a digit, an integer part that is too short, a trailing zero, the smallest integer
        ->and(Rank::isValid('0a'))->toBeFalse()
        ->and(Rank::isValid('b0'))->toBeFalse()
        ->and(Rank::isValid('a10'))->toBeFalse()
        ->and(Rank::isValid('A00000000000000000000000000'))->toBeFalse()
        ->and(Rank::DIGITS)->toBe('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz');

    expect(fn () => Rank::between(null, 'a0 '))->toThrow(InvalidArgumentException::class, 'a0 ')
        ->and(fn () => Rank::between('0a', null))->toThrow(InvalidArgumentException::class, '0a');
});

it('gives no keys for none and refuses a negative count', function () {
    expect(Rank::nBetween('a0', 'a1', 0))->toBe([])
        ->and(fn () => Rank::nBetween('a0', 'a1', -1))->toThrow(InvalidArgumentException::class);
});

it('spreads several keys between two neighbours in order', function () {
    $keys = Rank::nBetween('a0', 'a1', 25);

    expect($keys)->toHaveCount(25)
        ->and(array_unique($keys))->toHaveCount(25);

    $sorted = $keys;
    usort($sorted, strcmp(...));
    expect($sorted)->toBe($keys)
        ->and(strcmp($keys[0], 'a0'))->toBeGreaterThan(0)
        ->and(strcmp($keys[24], 'a1'))->toBeLessThan(0);
});
