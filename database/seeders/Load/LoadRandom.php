<?php

namespace Database\Seeders\Load;

use Random\Engine\Mt19937;
use Random\Randomizer;

/**
 * The one source of chance of the load data: a Mersenne Twister with seed 15, so every run draws the same numbers (in
 * place of mt_srand()/mt_rand(), which the security preset of the ArchTest forbids for good reason in the app). seed()
 * starts it over; LoadSeeder calls it first.
 */
final class LoadRandom
{
    public const SEED = 15;

    private static ?Randomizer $randomizer = null;

    public static function seed(int $seed = self::SEED): void
    {
        self::$randomizer = new Randomizer(new Mt19937($seed));
    }

    /** A whole number from `$min` to `$max`, both included. */
    public static function int(int $min, int $max): int
    {
        return self::randomizer()->getInt($min, $max);
    }

    /** True in `$tenths` of ten cases. */
    public static function chance(int $tenths): bool
    {
        return self::int(1, 10) <= $tenths;
    }

    /**
     * @template T
     *
     * @param  list<T>  $list
     * @return T
     */
    public static function pick(array $list): mixed
    {
        return $list[self::int(0, count($list) - 1)];
    }

    /**
     * @template T
     *
     * @param  list<T>  $list
     * @return list<T>
     */
    public static function shuffle(array $list): array
    {
        return self::randomizer()->shuffleArray($list);
    }

    /**
     * `$count` different entries of the list, in their order.
     *
     * @template T
     *
     * @param  list<T>  $list
     * @return list<T>
     */
    public static function some(array $list, int $count): array
    {
        if ($list === [] || $count < 1) {
            return [];
        }

        return array_map(fn (int $key) => $list[$key], self::randomizer()->pickArrayKeys($list, min($count, count($list))));
    }

    private static function randomizer(): Randomizer
    {
        return self::$randomizer ??= new Randomizer(new Mt19937(self::SEED));
    }
}
