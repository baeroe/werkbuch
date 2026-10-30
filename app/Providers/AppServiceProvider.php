<?php

namespace App\Providers;

use App\Models\PersonalAccessToken;
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
        //
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
        ]);

        Sanctum::usePersonalAccessTokenModel(PersonalAccessToken::class);
    }
}
