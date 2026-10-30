<?php

namespace App\Providers;

use App\Models\Event;
use App\Models\Organization;
use App\Models\PersonalAccessToken;
use App\Models\Project;
use App\Models\User;
use Illuminate\Database\Eloquent\Relations\Relation;
use Illuminate\Support\ServiceProvider;
use Laravel\Sanctum\Sanctum;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        // one row, read once per request (and per queued job)
        $this->app->scoped(Organization::class, fn () => Organization::query()->sole());
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
        ]);

        Sanctum::usePersonalAccessTokenModel(PersonalAccessToken::class);
    }
}
