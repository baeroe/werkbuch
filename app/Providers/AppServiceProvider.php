<?php

namespace App\Providers;

use App\Access\RoleIndex;
use App\Access\Visibility;
use App\Models\Attachment;
use App\Models\Event;
use App\Models\Invitation;
use App\Models\Label;
use App\Models\Organization;
use App\Models\PersonalAccessToken;
use App\Models\Project;
use App\Models\Property;
use App\Models\RelationType;
use App\Models\Resolution;
use App\Models\User;
use App\Models\View;
use App\Models\Workflow;
use App\Models\WorkItem;
use App\Models\WorkItemType;
use App\Search\MeilisearchEngine;
use App\Views\CatalogProperties;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Contracts\Foundation\Application;
use Illuminate\Database\Eloquent\Relations\Relation;
use Illuminate\Database\Events\TransactionRolledBack;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Event as Events;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use Laravel\Sanctum\Sanctum;
use Laravel\Scout\EngineManager;
use Meilisearch\Client;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        // one row, read once per request (and per queued job)
        $this->app->scoped(Organization::class, fn () => Organization::query()->sole());
        // the role assignments (and the visible projects), read once per request and job
        $this->app->scoped(RoleIndex::class);
        // the properties as filters, sorts and displays look them up, read once per request and job
        $this->app->scoped(CatalogProperties::class, fn () => CatalogProperties::load());
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        // every polymorphic reference (events, roles, tokens, media) stores the short name, never a class; later phases add
        // their models to this list, and a model without an entry fails loudly
        Relation::enforceMorphMap([
            'user' => User::class,
            'token' => PersonalAccessToken::class,
            'organization' => Organization::class,
            'project' => Project::class,
            'event' => Event::class,
            'invitation' => Invitation::class,
            'workflow' => Workflow::class,
            'work_item_type' => WorkItemType::class,
            'property' => Property::class,
            'label' => Label::class,
            'relation_type' => RelationType::class,
            'resolution' => Resolution::class,
            'work_item' => WorkItem::class,
            'view' => View::class,
            'attachment' => Attachment::class,
        ]);

        Sanctum::usePersonalAccessTokenModel(PersonalAccessToken::class);

        // roles and visible projects read inside a transaction that rolls back would otherwise outlive it and grant access
        Events::listen(TransactionRolledBack::class, fn () => Visibility::forget());

        // uploads (A234): 60 per minute and account, the routes behind `auth:sanctum` always know the account
        RateLimiter::for('attachments', fn (Request $request) => Limit::perMinute(60)->by((string) $request->user()?->getAuthIdentifier()));

        // the index is written by the search consumer only, never when a model is saved (P1)
        WorkItem::disableSearchSyncing();
        Project::disableSearchSyncing();
        User::disableSearchSyncing();

        // Scout's engine, able to remove the documents of a project's items by filter (RemovesWhere)
        resolve(EngineManager::class)->extend('meilisearch', fn (Application $app) => new MeilisearchEngine(
            $app->make(Client::class),
            (bool) config('scout.soft_delete'),
        ));
    }
}
