<?php

namespace App\Providers;

use App\Models\Attachment;
use App\Models\Comment;
use App\Models\Notification;
use App\Models\Page;
use App\Models\PageVersion;
use App\Models\Template;
use App\Models\View;
use App\Models\Webhook;
use App\Models\WebhookDelivery;
use App\Models\WorkItemRelation;
use App\Support\References;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\ServiceProvider;

/**
 * Binds the route parameters of the REST API and the web routes (`{item}`, `{project}`, ...). They live in a provider and
 * not in routes/api.php because `php artisan optimize` caches the routes: with cached routes Laravel loads no file under
 * routes/, and a `Route::bind` there would never run. `{item}` and `{project}` would then bind by primary key (404 for
 * keys and identifiers, no 301 for former ones).
 */
final class RouteBindingServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        // a project by its ULID, identifier or a former identifier; whether the account sees it, the action decides
        Route::bind('project', fn (string $ref) => References::project($ref));
        // a work item by its ULID or key (`WEB-12`, any case, also with a former identifier); whether the account sees it, the
        // action decides
        Route::bind('item', fn (string $ref) => References::item($ref));
        // a relation by its ULID (any case; anything else is no relation); whether the account sees an end, the action decides
        Route::bind('relation', fn (string $ref) => References::ulid(WorkItemRelation::class, $ref));
        // a view by its ULID (any case; anything else is no view); web routes name their parameter `{viewId}`, this binding is
        // global
        Route::bind('view', fn (string $ref) => References::ulid(View::class, $ref));
        // a comment by its ULID (any case; anything else is no comment); whether the account sees its item, the action decides
        Route::bind('comment', fn (string $ref) => References::ulid(Comment::class, $ref));
        // an attachment by its ULID (any case; anything else is no attachment), also for the file route of routes/web.php;
        // whether the account may read it, the action decides
        Route::bind('attachment', fn (string $ref) => References::ulid(Attachment::class, $ref));
        // a notification by its ULID (any case; anything else is no notification); whether it is the account's and still
        // visible to it, the action decides
        Route::bind('notification', fn (string $ref) => References::ulid(Notification::class, $ref));
        // a page of a wiki by its ULID (any case; anything else is no page); whether the account sees its project, the action
        // decides. The web route of the wiki names its parameter `{pageId}`, this binding is global
        Route::bind('page', fn (string $ref) => References::ulid(Page::class, $ref));
        // a kept version of a page by its ULID (any case; anything else is no version); whether it belongs to the page of the
        // route and the account sees it, the action decides
        Route::bind('pageVersion', fn (string $ref) => References::ulid(PageVersion::class, $ref));
        // a template by its ULID (any case; anything else is no template); whether the account sees its project, the action
        // decides. The web route of the templates names its parameter `{templateId}`, this binding is global
        Route::bind('template', fn (string $ref) => References::ulid(Template::class, $ref));
        // a webhook by its ULID (any case; anything else is no webhook); who may read it, the action decides
        Route::bind('webhook', fn (string $ref) => References::ulid(Webhook::class, $ref));

        // a delivery of a webhook by its ULID (any case; anything else is none); whether it belongs to the webhook of the route,
        // the action decides
        Route::bind('delivery', fn (string $ref) => References::ulid(WebhookDelivery::class, $ref));
    }
}
