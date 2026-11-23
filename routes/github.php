<?php

use App\Http\Controllers\GitHubWebhookController;
use App\Http\Middleware\VerifyGitHubSignature;
use Illuminate\Support\Facades\Route;

/*
 * The webhook of the one GitHub app (spec 11.4, WEBU-24), loaded by bootstrap/app.php without a middleware group: no
 * session, no CSRF, no bindings (like routes/runner.php). The throttle per address first, then the signature with the
 * secret of the app (401 otherwise); refusals are problems (ApiPaths). Not under /api/v1: no part of the OpenAPI
 * document or MCP.
 */
Route::post('github/webhook', [GitHubWebhookController::class, 'receive'])
    ->middleware(['throttle:github-webhook', VerifyGitHubSignature::class])
    ->name('github.webhook');
