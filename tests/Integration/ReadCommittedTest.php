<?php

use App\Support\ReadCommitted;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Exceptions;

/*
 * ReadCommitted::run (K4): the level is the session's, set before the caller's DB::transaction opens. Laravel connects
 * anew inside that BEGIN when the connection is gone (reconnectIfMissingConnection, handleBeginTransactionException)
 * and begins at once, so run cannot look in between: a listener on ConnectionEstablished sets the level again while a
 * run is open. And the level goes back afterwards; when that fails, the error of the transaction is the one that comes
 * out, the failed reset is reported. Without the test transaction (a feature test sits in one and never takes the
 * path: inside an open transaction run passes through).
 */

$level = fn (): string => (string) DB::scalar('select @@session.transaction_isolation');

it('sets the level again after a reconnect', function () use ($level) {
    $inside = ReadCommitted::run(function () use ($level) {
        // the connection is gone before the caller's transaction begins, as after a timeout of the server
        DB::disconnect();

        return DB::transaction(fn () => $level());
    });

    expect($inside)->toBe('READ-COMMITTED')
        ->and($level())->toBe('REPEATABLE-READ');
});

it('leaves the level of a connection made outside a run alone', function () use ($level) {
    ReadCommitted::run(fn () => DB::transaction(fn () => null));
    DB::disconnect();

    expect($level())->toBe('REPEATABLE-READ');
});

it('rethrows the error of the transaction when resetting the level fails', function () {
    Exceptions::fake();
    $reset = new RuntimeException('the reset failed');
    DB::connection()->beforeExecuting(function (string $query) use ($reset): void {
        if (preg_match('/^set session transaction isolation level repeatable read$/i', $query) === 1) {
            throw $reset;
        }
    });
    $failure = new LogicException('the transaction failed');

    $thrown = null;
    try {
        ReadCommitted::run(fn () => DB::transaction(fn () => throw $failure));
    } catch (Throwable $e) {
        $thrown = $e;
    }

    expect($thrown)->toBe($failure);
    Exceptions::assertReported(fn (RuntimeException $e) => $e === $reset);
});

it('throws the failed reset when the transaction went through', function () {
    Exceptions::fake();
    $reset = new RuntimeException('the reset failed');
    DB::connection()->beforeExecuting(function (string $query) use ($reset): void {
        if (preg_match('/^set session transaction isolation level repeatable read$/i', $query) === 1) {
            throw $reset;
        }
    });

    $thrown = null;
    try {
        ReadCommitted::run(fn () => DB::transaction(fn () => 'done'));
    } catch (Throwable $e) {
        $thrown = $e;
    }

    expect($thrown)->toBe($reset);
    Exceptions::assertNothingReported();
});
