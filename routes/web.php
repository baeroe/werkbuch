<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Inertia\Inertia;

// Every unknown path of the browser app is the Inertia 404 page (the status stays 404). The fallback also catches
// unknown /api paths: those stay an ordinary 404, which bootstrap/app.php answers as Problem Details.
Route::fallback(function (Request $request) {
    abort_if($request->is('api/*'), 404);

    return Inertia::render('Errors/NotFound')->toResponse($request)->setStatusCode(404);
});
