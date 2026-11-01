<?php

use App\Http\Controllers\ItemPageController;
use App\Http\Controllers\MediaController;
use App\Http\Controllers\ProjectItemsPageController;
use App\Http\Controllers\ProjectSettingsPageController;
use App\Http\Controllers\ViewPageController;
use App\Http\Middleware\EnsureAccountIsActive;
use App\Http\Middleware\EnsureTokenAbility;
use Illuminate\Http\Request;
use Illuminate\Session\Middleware\AuthenticateSession;
use Illuminate\Support\Facades\Route;
use Inertia\Inertia;
use Laravel\Sanctum\Http\Middleware\AuthenticateSession as SanctumAuthenticateSession;

require __DIR__.'/auth.php';

Route::middleware('auth')->group(function () {
    Route::redirect('/', '/my-items');
    // the three lists of "Meine Items": assigned, created, watched; their state (filter, layout …) lives in the query
    Route::inertia('/my-items', 'Items/MyItems')->name('my-items');
    Route::inertia('/created', 'Items/Created')->name('created');
    Route::inertia('/subscribed', 'Items/Subscribed')->name('subscribed');
    // the settings of the organization, one address per section; an unknown section is the page's business (it says so
    // and keeps the list)
    Route::redirect('/settings', '/settings/general');
    Route::get('/settings/{section}', fn (string $section) => Inertia::render('Settings/Organization', ['section' => $section]))
        ->name('settings');
    // the own settings: profile, security, API and MCP; the profile without a section (spec 5.2)
    Route::get('/me/{section?}', fn (string $section = 'profile') => Inertia::render('Settings/Personal', ['section' => $section]))
        ->name('me');
    // all projects; `?create=1` (the sidebar's "Create project") opens the dialog once
    Route::get('/projects', fn (Request $request) => Inertia::render('Projects/Index', ['create' => $request->query('create') === '1']))
        ->name('projects');
    // never `{project}`: the binding of routes/api.php would resolve it and hide a former identifier from GetProject
    // the items of a project; never `{project}` (see below)
    Route::get('/projects/{identifier}', ProjectItemsPageController::class)->name('projects.show');
    Route::get('/projects/{identifier}/settings/{section?}', ProjectSettingsPageController::class)->name('projects.settings');
    // the page of an item by its key; never `{item}`: the binding of routes/api.php would resolve it and hide a former key
    Route::get('/items/{key}', ItemPageController::class)->name('items.show');
    // the items of a saved view; never `{view}`: the binding of routes/api.php would answer an unknown id before the page
    Route::get('/views/{viewId}', ViewPageController::class)->name('views.show');
});

// pictures (logo, avatars, project pictures) from the private disk, for the session and for tokens that may read (P15);
// Sanctum's own AuthenticateSession instead of the framework's, which only knows session guards and fails on Sanctum's
Route::middleware(['auth:sanctum', SanctumAuthenticateSession::class, EnsureAccountIsActive::class, EnsureTokenAbility::class])
    ->withoutMiddleware(AuthenticateSession::class)
    ->get('/media/{media:uuid}', [MediaController::class, 'show'])->name('media.show');

// Every unknown path of the browser app is the Inertia 404 page for signed-in people (the status stays 404) and the
// sign-in for guests: no auth middleware here, because the fallback also catches unknown /api paths, and those stay an
// ordinary 404 that bootstrap/app.php answers as Problem Details, for guests as well. Guests go to the sign-in without
// the path being remembered: the browser's background requests (favicon, apple-touch-icon, devtools JSON) would replace
// the intended page, and the sign-in would end on a 404.
Route::fallback(function (Request $request) {
    abort_if($request->is('api/*'), 404);

    if ($request->user() === null) {
        return redirect()->route('login');
    }

    return Inertia::render('Errors/NotFound')->toResponse($request)->setStatusCode(404);
});
