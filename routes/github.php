<?php

use App\Http\Controllers\GitHubWebhookController;
use App\Http\Middleware\VerifyGitHubSignature;
use Illuminate\Support\Facades\Route;

/*
 * The webhook of the one GitHub app (spec 11.4, WEBU-24), loaded by bootstrap/app.php without a middleware group: no
 * session, no CSRF, no bindings (like routes/runner.php). The signature with the secret of the app decides (401
 * otherwise, unsigned requests throttled per address); refusals are problems (ApiPaths). Bodies up to 25 MB as GitHub
 * sends them, not the 8 MiB of the API. Not under /api/v1: no part of the OpenAPI document or MCP.
 */
Route::post('github/webhook', [GitHubWebhookController::class, 'receive'])
    ->middleware(VerifyGitHubSignature::class)
    ->name('github.webhook');
