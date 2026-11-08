<?php

use App\Models\User;
use App\Support\BotIds;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/*
 * BotIds answers which accounts are bots, once per request and job (T10-M8, K11): preload asks many ids with one query,
 * isBot answers from what it read and asks an unknown id on its own.
 */

/** Runs the call with the query log on and answers how many queries it sent. */
$queries = function (callable $call): int {
    DB::flushQueryLog();
    DB::enableQueryLog();
    $call();
    DB::disableQueryLog();

    return count(DB::getQueryLog());
};

it('reads many ids with one query and answers from memory', function () use ($queries) {
    $person = User::factory()->create();
    $bot = User::factory()->bot($person)->create();
    $other = User::factory()->bot($person)->create();
    $nobody = strtolower((string) Str::ulid());
    $ids = app(BotIds::class);

    expect($queries(fn () => $ids->preload([$person->id, $bot->id, $nobody, $bot->id])))->toBe(1)
        // known ids are not asked again
        ->and($queries(fn () => $ids->preload([$person->id, $bot->id])))->toBe(0)
        ->and($queries(fn () => expect([$ids->isBot($person->id), $ids->isBot($bot->id), $ids->isBot($nobody)])->toBe([false, true, false])))->toBe(0)
        // an id nobody preloaded on its own
        ->and($queries(fn () => expect($ids->isBot($other->id))->toBeTrue()))->toBe(1)
        ->and($queries(fn () => expect($ids->isBot($other->id))->toBeTrue()))->toBe(0);
});

it('is one instance per request and job', function () {
    $person = User::factory()->create();
    app(BotIds::class)->preload([$person->id]);

    expect(app(BotIds::class))->toBe(app(BotIds::class));
    app()->forgetScopedInstances();
    DB::flushQueryLog();
    DB::enableQueryLog();
    app(BotIds::class)->isBot($person->id);
    DB::disableQueryLog();

    expect(DB::getQueryLog())->toHaveCount(1);
});

it('reads an id in any case as the same account (T13a-M1)', function () use ($queries) {
    $person = User::factory()->create();
    $bot = User::factory()->bot($person)->create();
    $ids = app(BotIds::class);

    // the collation finds the account in any case; the answer is held under the canonical id
    expect($ids->isBot(strtoupper($bot->id)))->toBeTrue()
        ->and($queries(fn () => expect([$ids->isBot($bot->id), $ids->isBot(strtoupper($person->id))])->toBe([true, false])))->toBe(1)
        ->and($queries(fn () => $ids->preload([strtoupper($bot->id), $person->id])))->toBe(0);
});
