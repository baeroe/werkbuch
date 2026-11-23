<?php

use App\Http\Controllers\RunnerProtocolController;
use App\Http\Middleware\AuthenticateRunner;
use App\Http\Middleware\SetLocale;
use Illuminate\Support\Facades\Route;

/*
 * The runner protocol (spec 6, A487), loaded by bootstrap/app.php without a middleware group: no session, no CSRF, no
 * bindings. Under /api: refusals are problems; not under /api/v1: no part of the OpenAPI document or MCP. Pairing takes
 * the one-time code (throttle `runner-pair` per address); everything else the token of a runner (throttle `runner` per
 * runner, before the authentication, so a flood of wrong tokens spends the address's quota).
 */
Route::prefix('api/runner')->middleware(SetLocale::class.':'.SetLocale::API)->group(function () {
    Route::post('pair', [RunnerProtocolController::class, 'pair'])->middleware('throttle:runner-pair')->name('runner.pair');

    Route::middleware(['throttle:runner', AuthenticateRunner::class])->group(function () {
        Route::post('claim', [RunnerProtocolController::class, 'claim'])->name('runner.claim');
        Route::post('runs/{runId}/heartbeat', [RunnerProtocolController::class, 'heartbeat'])->name('runner.heartbeat');
        Route::post('runs/{runId}/events', [RunnerProtocolController::class, 'events'])->name('runner.events');
        Route::post('runs/{runId}/result', [RunnerProtocolController::class, 'result'])->name('runner.result');
    });
});
