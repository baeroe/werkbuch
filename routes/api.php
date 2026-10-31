<?php

use App\Exceptions\Problem;
use App\Http\Controllers\Api\BotsController;
use App\Http\Controllers\Api\FavoritesController;
use App\Http\Controllers\Api\InvitationsController;
use App\Http\Controllers\Api\MembersController;
use App\Http\Controllers\Api\OrganizationController;
use App\Http\Controllers\Api\PasswordController;
use App\Http\Controllers\Api\ProjectsController;
use App\Http\Controllers\Api\TokensController;
use App\Http\Controllers\Api\TwoFactorController;
use App\Http\Controllers\Api\UsersController;
use App\Http\Controllers\Api\WorkflowsController;
use App\Http\Middleware\EnsureAccountIsActive;
use App\Http\Middleware\EnsureSession;
use App\Http\Middleware\EnsureTokenAbility;
use App\Models\Project;
use Illuminate\Support\Facades\Route;

// a project by its ULID, identifier or a former identifier; whether the account sees it, the action decides
Route::bind('project', fn (string $ref) => Project::findByReference($ref) ?? throw Problem::notFound());

// The REST API (prefix api/v1, see bootstrap/app.php): the session of the interface (with CSRF) or a bearer token whose
// abilities fit the method. Every route has a row in tests/Feature/Api/routes.php.
Route::middleware(['auth:sanctum', EnsureAccountIsActive::class, EnsureTokenAbility::class])->group(function () {
    Route::get('organization', [OrganizationController::class, 'show']);
    Route::patch('organization', [OrganizationController::class, 'update']);

    Route::get('users', [UsersController::class, 'index']);
    Route::patch('users/{user}', [UsersController::class, 'update']);
    Route::put('users/{user}/role', [UsersController::class, 'updateRole']);
    Route::post('users/{user}/deactivate', [UsersController::class, 'deactivate']);
    Route::post('users/{user}/reactivate', [UsersController::class, 'reactivate']);

    Route::get('bots', [BotsController::class, 'index']);
    Route::post('bots', [BotsController::class, 'store']);

    Route::get('invitations', [InvitationsController::class, 'index']);
    Route::post('invitations', [InvitationsController::class, 'store']);

    Route::get('projects', [ProjectsController::class, 'index']);
    Route::post('projects', [ProjectsController::class, 'store']);
    Route::get('projects/{project}', [ProjectsController::class, 'show']);
    Route::patch('projects/{project}', [ProjectsController::class, 'update']);
    Route::delete('projects/{project}', [ProjectsController::class, 'destroy']);
    Route::post('projects/{project}/archive', [ProjectsController::class, 'archive']);
    Route::post('projects/{project}/restore', [ProjectsController::class, 'restore']);

    Route::post('projects/{project}/join', [MembersController::class, 'join']);
    Route::get('projects/{project}/members', [MembersController::class, 'index']);
    Route::post('projects/{project}/members', [MembersController::class, 'store']);
    Route::patch('projects/{project}/members/{user}', [MembersController::class, 'update']);
    Route::delete('projects/{project}/members/{user}', [MembersController::class, 'destroy']);

    Route::get('workflows', [WorkflowsController::class, 'index']);
    Route::post('workflows', [WorkflowsController::class, 'store']);
    Route::put('workflows/{workflow}', [WorkflowsController::class, 'update']);
    Route::delete('workflows/{workflow}', [WorkflowsController::class, 'destroy']);

    Route::get('favorites', [FavoritesController::class, 'index']);
    Route::post('favorites/toggle', [FavoritesController::class, 'toggle']);

    Route::get('tokens', [TokensController::class, 'index']);
    Route::delete('tokens/{token}', [TokensController::class, 'destroy']);

    // only from the session of the interface, never with a token (P6): no token mints tokens (no wider abilities, no
    // tokens of bots, no longer life), and the own password and second factor stay out of a stolen token's reach
    Route::middleware(EnsureSession::class)->group(function () {
        Route::post('tokens', [TokensController::class, 'store']);
    });
    Route::middleware(EnsureSession::class)->prefix('me')->group(function () {
        Route::put('password', [PasswordController::class, 'update'])->middleware('throttle:password-change');
        Route::get('two-factor', [TwoFactorController::class, 'show']);
        Route::post('two-factor', [TwoFactorController::class, 'store']);
        Route::post('two-factor/confirm', [TwoFactorController::class, 'confirm'])->middleware('throttle:6,1');
        Route::delete('two-factor', [TwoFactorController::class, 'destroy']);
        Route::post('two-factor/recovery-codes', [TwoFactorController::class, 'recoveryCodes']);
    });
});
