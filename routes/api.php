<?php

use App\Http\Controllers\Api\AttachmentsController;
use App\Http\Controllers\Api\AutomationsController;
use App\Http\Controllers\Api\BotsController;
use App\Http\Controllers\Api\CommentsController;
use App\Http\Controllers\Api\FavoritesController;
use App\Http\Controllers\Api\HistoryController;
use App\Http\Controllers\Api\InvitationsController;
use App\Http\Controllers\Api\LabelsController;
use App\Http\Controllers\Api\MeController;
use App\Http\Controllers\Api\MembersController;
use App\Http\Controllers\Api\NotificationPreferencesController;
use App\Http\Controllers\Api\NotificationsController;
use App\Http\Controllers\Api\OrganizationController;
use App\Http\Controllers\Api\PagesController;
use App\Http\Controllers\Api\PageVersionsController;
use App\Http\Controllers\Api\PasswordController;
use App\Http\Controllers\Api\ProjectsController;
use App\Http\Controllers\Api\PropertiesController;
use App\Http\Controllers\Api\RelationsController;
use App\Http\Controllers\Api\RelationTypesController;
use App\Http\Controllers\Api\ResolutionsController;
use App\Http\Controllers\Api\RichTextController;
use App\Http\Controllers\Api\SearchController;
use App\Http\Controllers\Api\StateUsageController;
use App\Http\Controllers\Api\SubscribersController;
use App\Http\Controllers\Api\SystemController;
use App\Http\Controllers\Api\TemplatesController;
use App\Http\Controllers\Api\TokensController;
use App\Http\Controllers\Api\TwoFactorController;
use App\Http\Controllers\Api\UsersController;
use App\Http\Controllers\Api\ViewsController;
use App\Http\Controllers\Api\WebhooksController;
use App\Http\Controllers\Api\WorkflowsController;
use App\Http\Controllers\Api\WorkItemsController;
use App\Http\Controllers\Api\WorkItemTypesController;
use App\Http\Middleware\EnsureAccountIsActive;
use App\Http\Middleware\EnsureSession;
use App\Http\Middleware\EnsureTokenAbility;
use App\Http\Middleware\RedirectFormerItemKey;
use Illuminate\Support\Facades\Route;

// Route parameters are bound in App\Providers\RouteBindingServiceProvider: with cached routes (the image) this file
// never runs.

// The REST API (prefix api/v1, see bootstrap/app.php): the session of the interface (with CSRF) or a bearer token whose
// abilities fit the method. Every route has a row in tests/Feature/Api/routes.php.
Route::middleware(['auth:sanctum', EnsureAccountIsActive::class, EnsureTokenAbility::class])->group(function () {
    Route::get('organization', [OrganizationController::class, 'show']);
    Route::patch('organization', [OrganizationController::class, 'update']);

    // the own account (also of a read token, A392) and one account by its ULID
    Route::get('me', [MeController::class, 'show']);
    Route::get('users', [UsersController::class, 'index']);
    Route::get('users/{user}', [UsersController::class, 'show']);
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
    Route::put('projects/{project}/workflow', [ProjectsController::class, 'assignWorkflow']);

    Route::post('projects/{project}/join', [MembersController::class, 'join']);
    Route::get('projects/{project}/members', [MembersController::class, 'index']);
    Route::post('projects/{project}/members', [MembersController::class, 'store']);
    Route::patch('projects/{project}/members/{user}', [MembersController::class, 'update']);
    Route::delete('projects/{project}/members/{user}', [MembersController::class, 'destroy']);

    // the wiki of a project: the whole tree without text (A315), a page with its text; creating, saving, moving and
    // deleting pages (a page goes with its subtree)
    Route::get('projects/{project}/pages', [PagesController::class, 'index']);
    Route::post('projects/{project}/pages', [PagesController::class, 'store']);
    Route::get('pages/{page}', [PagesController::class, 'show']);
    Route::patch('pages/{page}', [PagesController::class, 'update']);
    Route::post('pages/{page}/move', [PagesController::class, 'move']);
    Route::delete('pages/{page}', [PagesController::class, 'destroy']);
    // the kept versions of a page: the list without text (A315), one with its text, restoring one as the newest state
    Route::get('pages/{page}/versions', [PageVersionsController::class, 'index']);
    Route::get('pages/{page}/versions/{pageVersion}', [PageVersionsController::class, 'show']);
    Route::post('pages/{page}/versions/{pageVersion}/restore', [PageVersionsController::class, 'restore']);

    // the templates of a project (spec 4.12): all the account sees (the palette, `?project=` narrows) or those of one
    // project; creating, replacing (A75) and deleting one
    Route::get('templates', [TemplatesController::class, 'index']);
    Route::get('projects/{project}/templates', [TemplatesController::class, 'projectIndex']);
    Route::post('projects/{project}/templates', [TemplatesController::class, 'store']);
    Route::get('templates/{template}', [TemplatesController::class, 'show']);
    Route::put('templates/{template}', [TemplatesController::class, 'update']);
    Route::delete('templates/{template}', [TemplatesController::class, 'destroy']);
    Route::get('templates/{template}/draft', [TemplatesController::class, 'draft']);
    Route::post('templates/{template}/run', [TemplatesController::class, 'run']);
    Route::get('templates/{template}/runs', [TemplatesController::class, 'runs']);
    // reads only, over a body: a read token may ask it (P15)
    Route::post('templates/preview', [TemplatesController::class, 'preview'])->defaults('token_ability', 'read');

    // the four automations of a project (A346), switched by their key
    Route::get('projects/{project}/automations', [AutomationsController::class, 'index']);
    Route::put('projects/{project}/automations/{key}', [AutomationsController::class, 'update']);

    Route::get('workflows', [WorkflowsController::class, 'index']);
    Route::post('workflows', [WorkflowsController::class, 'store']);
    Route::get('workflows/{workflow}', [WorkflowsController::class, 'show']);
    Route::put('workflows/{workflow}', [WorkflowsController::class, 'update']);
    Route::delete('workflows/{workflow}', [WorkflowsController::class, 'destroy']);
    Route::get('state-usage', [StateUsageController::class, 'index']);

    Route::get('work-item-types', [WorkItemTypesController::class, 'index']);
    Route::post('work-item-types', [WorkItemTypesController::class, 'store']);
    Route::get('work-item-types/{workItemType}', [WorkItemTypesController::class, 'show']);
    Route::put('work-item-types/{workItemType}', [WorkItemTypesController::class, 'update']);
    Route::delete('work-item-types/{workItemType}', [WorkItemTypesController::class, 'destroy']);

    Route::get('properties', [PropertiesController::class, 'index']);
    Route::post('properties', [PropertiesController::class, 'store']);
    Route::get('properties/{property}', [PropertiesController::class, 'show']);
    Route::put('properties/{property}', [PropertiesController::class, 'update']);
    Route::delete('properties/{property}', [PropertiesController::class, 'destroy']);

    Route::get('labels', [LabelsController::class, 'index']);
    Route::post('labels', [LabelsController::class, 'store']);
    Route::get('labels/{label}', [LabelsController::class, 'show']);
    Route::put('labels/{label}', [LabelsController::class, 'update']);
    Route::delete('labels/{label}', [LabelsController::class, 'destroy']);

    Route::get('relation-types', [RelationTypesController::class, 'index']);
    Route::post('relation-types', [RelationTypesController::class, 'store']);
    Route::get('relation-types/{relationType}', [RelationTypesController::class, 'show']);
    Route::put('relation-types/{relationType}', [RelationTypesController::class, 'update']);
    Route::delete('relation-types/{relationType}', [RelationTypesController::class, 'destroy']);

    Route::get('resolutions', [ResolutionsController::class, 'index']);
    Route::post('resolutions', [ResolutionsController::class, 'store']);
    Route::get('resolutions/{resolution}', [ResolutionsController::class, 'show']);
    Route::put('resolutions/{resolution}', [ResolutionsController::class, 'update']);
    Route::delete('resolutions/{resolution}', [ResolutionsController::class, 'destroy']);

    Route::get('work-items', [WorkItemsController::class, 'index']);
    Route::post('work-items', [WorkItemsController::class, 'store']);
    // before {item}: `bulk`, `query`, `groups` and `counts` are no items; the last three only read (P15), a read-only
    // token may send them
    Route::post('work-items/bulk', [WorkItemsController::class, 'bulk']);
    // new short ranks for the items of a project in their order (A448)
    Route::post('projects/{project}/redistribute-ranks', [WorkItemsController::class, 'redistributeRanks']);
    Route::post('work-items/query', [WorkItemsController::class, 'query'])->defaults('token_ability', 'read');
    Route::post('work-items/groups', [WorkItemsController::class, 'groups'])->defaults('token_ability', 'read');
    Route::post('work-items/counts', [WorkItemsController::class, 'counts'])->defaults('token_ability', 'read');
    // a read by a former key moves to the current one (301); every route with {item} belongs in this group
    Route::middleware(RedirectFormerItemKey::class)->group(function () {
        Route::get('work-items/{item}', [WorkItemsController::class, 'show']);
        Route::patch('work-items/{item}', [WorkItemsController::class, 'update']);
        Route::post('work-items/{item}/transition', [WorkItemsController::class, 'transition']);
        Route::put('work-items/{item}/type', [WorkItemsController::class, 'changeType']);
        Route::post('work-items/{item}/archive', [WorkItemsController::class, 'archive']);
        Route::post('work-items/{item}/restore', [WorkItemsController::class, 'restore']);
        Route::delete('work-items/{item}', [WorkItemsController::class, 'destroy']);
        Route::get('work-items/{item}/subscribers', [SubscribersController::class, 'index']);
        Route::put('work-items/{item}/subscription', [SubscribersController::class, 'store']);
        Route::delete('work-items/{item}/subscription', [SubscribersController::class, 'destroy']);
        Route::get('work-items/{item}/relations', [RelationsController::class, 'index']);
        Route::post('work-items/{item}/relations', [RelationsController::class, 'store']);
        Route::get('work-items/{item}/history', [HistoryController::class, 'index']);
        Route::get('work-items/{item}/comments', [CommentsController::class, 'index']);
        Route::post('work-items/{item}/comments', [CommentsController::class, 'store']);
    });
    Route::get('comments/{comment}', [CommentsController::class, 'show']);
    Route::patch('comments/{comment}', [CommentsController::class, 'update']);
    Route::delete('comments/{comment}', [CommentsController::class, 'destroy']);
    Route::put('comments/{comment}/reactions', [CommentsController::class, 'react']);
    Route::delete('comments/{comment}/reactions', [CommentsController::class, 'unreact']);
    Route::delete('relations/{relation}', [RelationsController::class, 'destroy']);

    Route::get('views', [ViewsController::class, 'index']);
    Route::post('views', [ViewsController::class, 'store']);
    Route::get('views/{view}', [ViewsController::class, 'show']);
    Route::put('views/{view}', [ViewsController::class, 'update']);
    Route::delete('views/{view}', [ViewsController::class, 'destroy']);

    Route::get('search', SearchController::class)->name('api.search');

    // what the editor of rich text reads: who can be mentioned, the items behind references
    Route::get('mentions', [RichTextController::class, 'mentions']);
    Route::get('references', [RichTextController::class, 'references']);

    // multipart, the file under `file`; at most 60 uploads per minute and account
    Route::post('attachments', [AttachmentsController::class, 'store'])->middleware('throttle:attachments');
    Route::get('attachments/{attachment}', [AttachmentsController::class, 'show']);
    Route::delete('attachments/{attachment}', [AttachmentsController::class, 'destroy']);

    Route::get('favorites', [FavoritesController::class, 'index']);
    Route::post('favorites/toggle', [FavoritesController::class, 'toggle']);

    // the own inbox; marking reads nothing but writes, so it wants `write`
    Route::get('notifications', [NotificationsController::class, 'index']);
    Route::post('notifications/read', [NotificationsController::class, 'read']);
    Route::post('notifications/unread', [NotificationsController::class, 'unread']);
    Route::delete('notifications/{notification}', [NotificationsController::class, 'destroy']);

    Route::get('notification-preferences', [NotificationPreferencesController::class, 'show']);
    Route::put('notification-preferences', [NotificationPreferencesController::class, 'update']);

    // the system page (A287, org admins); the status reads, the rest writes
    Route::get('system', [SystemController::class, 'show']);
    Route::post('system/failed-jobs/retry', [SystemController::class, 'retry']);
    Route::post('system/test-mail', [SystemController::class, 'testMail'])->middleware('throttle:test-mail');

    // the webhooks (spec 6.3, org admins); the secret is in the answers of creating and of rotate-secret only
    Route::get('webhooks', [WebhooksController::class, 'index']);
    Route::post('webhooks', [WebhooksController::class, 'store']);
    Route::get('webhooks/{webhook}', [WebhooksController::class, 'show']);
    Route::put('webhooks/{webhook}', [WebhooksController::class, 'update']);
    Route::delete('webhooks/{webhook}', [WebhooksController::class, 'destroy']);
    Route::post('webhooks/{webhook}/rotate-secret', [WebhooksController::class, 'rotateSecret']);
    // the log, the test ping and "send again" (the two senders make their one try in the request: six a minute per account)
    Route::get('webhooks/{webhook}/deliveries', [WebhooksController::class, 'deliveries']);
    Route::post('webhooks/{webhook}/ping', [WebhooksController::class, 'ping'])->middleware('throttle:webhook-send');
    Route::post('webhooks/{webhook}/deliveries/{delivery}/redeliver', [WebhooksController::class, 'redeliver'])->middleware('throttle:webhook-send');

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
