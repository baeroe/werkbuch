<?php

use App\Models\User;
use Illuminate\Cookie\Middleware\EncryptCookies;
use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;
use Illuminate\Support\Facades\Gate;
use Laravel\Sanctum\Http\Middleware\AuthenticateSession;

it('hands out the CSRF cookie for the API session', function () {
    $this->get('/sanctum/csrf-cookie')->assertNoContent()->assertCookie('XSRF-TOKEN');
});

it('does not let the permission package answer gate checks', function () {
    expect(config('permission.register_permission_check_method'))->toBeFalse()
        ->and(Gate::forUser(User::factory()->create())->allows('org.manage'))->toBeFalse();
});

it('names the middleware of the framework that replaced the deprecated CSRF classes', function () {
    expect(config('sanctum.middleware.validate_csrf_token'))->toBe(PreventRequestForgery::class)
        ->and(config('sanctum.middleware.authenticate_session'))->toBe(AuthenticateSession::class)
        ->and(config('sanctum.middleware.encrypt_cookies'))->toBe(EncryptCookies::class);
});
