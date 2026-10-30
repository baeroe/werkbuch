<?php

use App\Http\Controllers\Auth\InvitationController;
use App\Http\Controllers\Auth\NewPasswordController as SetNewPasswordController;
use App\Http\Controllers\Auth\PasswordResetLinkController as SendPasswordResetLinkController;
use Illuminate\Support\Facades\Route;
use Laravel\Fortify\Http\Controllers\AuthenticatedSessionController;
use Laravel\Fortify\Http\Controllers\NewPasswordController;
use Laravel\Fortify\Http\Controllers\PasswordResetLinkController;

// The routes of Fortify that werkbuch uses (FortifyServiceProvider ignores Fortify's own route file, which would also
// register password confirmation). POST /forgot-password and POST /reset-password are werkbuch's own
// (App\Http\Controllers\Auth). Loaded inside the web group by routes/web.php.
Route::middleware('guest:'.config('fortify.guard'))->group(function () {
    Route::get('/login', [AuthenticatedSessionController::class, 'create'])->name('login');
    Route::post('/login', [AuthenticatedSessionController::class, 'store'])->middleware('throttle:login')->name('login.store');

    Route::get('/forgot-password', [PasswordResetLinkController::class, 'create'])->name('password.request');
    Route::post('/forgot-password', [SendPasswordResetLinkController::class, 'store'])->middleware('throttle:password-reset')->name('password.email');
    Route::get('/reset-password/{token}', [NewPasswordController::class, 'create'])->name('password.reset');
    Route::post('/reset-password', [SetNewPasswordController::class, 'store'])->middleware('throttle:password-update')->name('password.update');
});

// The page of an invitation link and its form: only with the signature the link was issued with (relative, so APP_URL
// may differ from the host the browser reaches), for guests; the invitation row decides whether it still works.
Route::middleware(['guest:'.config('fortify.guard'), 'signed:relative'])->group(function () {
    Route::get('/invitations/{invitation}', [InvitationController::class, 'show'])->name('invitations.show');
    Route::post('/invitations/{invitation}', [InvitationController::class, 'accept'])->middleware('throttle:invitation')->name('invitations.accept');
});

Route::post('/logout', [AuthenticatedSessionController::class, 'destroy'])->middleware('auth:'.config('fortify.guard'))->name('logout');
