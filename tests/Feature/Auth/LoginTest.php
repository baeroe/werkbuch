<?php

use App\Actions\Auth\Authenticate;
use App\Models\User;
use Illuminate\Contracts\Auth\Middleware\AuthenticatesRequests;
use Illuminate\Contracts\Http\Kernel;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\Hash;
use Inertia\Testing\AssertableInertia as Assert;

it('shows the sign-in page to guests and leads signed-in people on', function () {
    $this->get('/login')->assertOk()->assertInertia(fn (Assert $p) => $p->component('Auth/Login'));
    $this->actingAs(User::factory()->create())->get('/login')->assertRedirect('/my-items');
});

it('signs a person in with any case of the email and leads to my items', function () {
    User::factory()->create(['email' => 'mara@example.com', 'password' => 'secret-pass']);
    $this->post('/login', ['email' => ' Mara@Example.com ', 'password' => 'secret-pass'])->assertRedirect('/my-items');
    $this->assertAuthenticated();
});

it('refuses wrong passwords, disabled accounts and bots with the same message', function (Closure $make, string $password) {
    $make();
    $this->from('/login')->post('/login', ['email' => 'x@example.com', 'password' => $password])
        ->assertRedirect('/login')->assertSessionHasErrors(['email' => __('auth.failed')]);
    $this->assertGuest();
})->with([
    'wrong password' => [fn () => User::factory()->create(['email' => 'x@example.com', 'password' => 'secret-pass']), 'wrong-pass'],
    'disabled' => [fn () => User::factory()->disabled()->create(['email' => 'x@example.com', 'password' => 'secret-pass']), 'secret-pass'],
    'bot' => [fn () => User::factory()->bot()->create(['email' => 'x@example.com']), 'anything'],
    'unknown' => [fn () => null, 'secret-pass'],
]);

it('checks exactly one hash for every attempt, so the answer time does not tell whether the account exists', function (Closure $make, bool $signsIn) {
    $make();
    Hash::shouldReceive('check')->once()->andReturnUsing(fn (string $value, string $hash) => password_verify($value, $hash));

    $user = Authenticate::run('x@example.com', 'secret-pass');

    expect($user !== null)->toBe($signsIn);
})->with([
    'person' => [fn () => User::factory()->create(['email' => 'x@example.com', 'password' => 'secret-pass']), true],
    'unknown' => [fn () => null, false],
    'disabled' => [fn () => User::factory()->disabled()->create(['email' => 'x@example.com', 'password' => 'secret-pass']), false],
    'bot' => [fn () => User::factory()->bot()->create(['email' => 'x@example.com']), false],
    'without password' => [fn () => User::factory()->create(['email' => 'x@example.com', 'password' => null]), false],
]);

it('checks unknown addresses against a real bcrypt hash of the default cost', function () {
    expect(Hash::isHashed(Authenticate::DUMMY_HASH))->toBeTrue()
        ->and(password_get_info(Authenticate::DUMMY_HASH)['options']['cost'] ?? null)->toBe(12);
});

it('signs in the account of app:ensure-admin', function () {
    config(['werkbuch.admin.email' => 'owner@example.com', 'werkbuch.admin.password' => 'secret-pass']);
    $this->artisan('app:ensure-admin')->assertSuccessful();

    $this->post('/login', ['email' => 'owner@example.com', 'password' => 'secret-pass'])->assertRedirect('/my-items');
    $this->assertAuthenticated();
});

it('signs out and leads to the sign-in', function () {
    $this->actingAs(User::factory()->create())->post('/logout')->assertRedirect('/login');
    $this->assertGuest();
});

it('sends guests to the sign-in', function () {
    $this->post('/logout')->assertRedirect('/login');
});

it('rate-limits before it authenticates', function () {
    $priority = app(Kernel::class)->getMiddlewarePriority();

    expect(array_search(ThrottleRequests::class, $priority, true))->toBeLessThan(array_search(AuthenticatesRequests::class, $priority, true));
});
