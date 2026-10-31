<?php

use App\Models\User;
use Illuminate\Support\Facades\Gate;

it('hands out the CSRF cookie for the API session', function () {
    $this->get('/sanctum/csrf-cookie')->assertNoContent()->assertCookie('XSRF-TOKEN');
});

it('does not let the permission package answer gate checks', function () {
    expect(config('permission.register_permission_check_method'))->toBeFalse()
        ->and(Gate::forUser(User::factory()->create())->allows('org.manage'))->toBeFalse();
});
