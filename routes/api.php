<?php

use App\Exceptions\Problem;
use App\Http\Controllers\Api\BotsController;
use App\Http\Controllers\Api\FavoritesController;
use App\Http\Controllers\Api\InvitationsController;
use App\Http\Controllers\Api\LabelsController;
use App\Http\Controllers\Api\MembersController;
use App\Http\Controllers\Api\OrganizationController;
use App\Http\Controllers\Api\PasswordController;
use App\Http\Controllers\Api\ProjectsController;
use App\Http\Controllers\Api\PropertiesController;
use App\Http\Controllers\Api\RelationTypesController;
use App\Http\Controllers\Api\ResolutionsController;
use App\Http\Controllers\Api\TokensController;
use App\Http\Controllers\Api\TwoFactorController;
use App\Http\Controllers\Api\UsersController;
use App\Http\Controllers\Api\WorkflowsController;
use App\Http\Controllers\Api\WorkItemTypesController;
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

    Route::get('work-item-types', [WorkItemTypesController::class, 'index']);
    Route::post('work-item-types', [WorkItemTypesController::class, 'store']);
    Route::put('work-item-types/{workItemType}', [WorkItemTypesController::class, 'update']);
    Route::delete('work-item-types/{workItemType}', [WorkItemTypesController::class, 'destroy']);

    Route::get('properties', [PropertiesController::class, 'index']);
    Route::post('properties', [PropertiesController::class, 'store']);
    Route::put('properties/{property}', [PropertiesController::class, 'update']);
    Route::delete('properties/{property}', [PropertiesController::class, 'destroy']);

    Route::get('labels', [LabelsController::class, 'index']);
    Route::post('labels', [LabelsController::class, 'store']);
    Route::put('labels/{label}', [LabelsController::class, 'update']);
    Route::delete('labels/{label}', [LabelsController::class, 'destroy']);

    Route::get('relation-types', [RelationTypesController::class, 'index']);
    Route::post('relation-types', [RelationTypesController::class, 'store']);
    Route::put('relation-types/{relationType}', [RelationTypesController::class, 'update']);
    Route::delete('relation-types/{relationType}', [RelationTypesController::class, 'destroy']);

    Route::get('resolutions', [ResolutionsController::class, 'index']);
    Route::post('resolutions', [ResolutionsController::class, 'store']);
    Route::put('resolutions/{resolution}', [ResolutionsController::class, 'update']);
    Route::delete('resolutions/{resolution}', [ResolutionsController::class, 'destroy']);

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
