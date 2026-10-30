<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Inertia\Inertia;

require __DIR__.'/auth.php';

Route::middleware('auth')->group(function () {
    Route::redirect('/', '/my-items');
    Route::inertia('/my-items', 'Items/MyItems')->name('my-items');
});

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
