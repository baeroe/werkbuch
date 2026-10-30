<?php

use App\Actions\Auth\Authenticate;
use App\Models\User;
use Illuminate\Contracts\Auth\Middleware\AuthenticatesRequests;
use Illuminate\Contracts\Http\Kernel;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Routing\Route as RoutingRoute;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Route;
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
    Authenticate::dummyHash(); // made once and kept; from here on only the check runs
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

it('checks unknown addresses against a hash of the configured hasher, made once', function () {
    $dummy = Authenticate::dummyHash();

    expect(Hash::isHashed($dummy))->toBeTrue()
        ->and(Hash::needsRehash($dummy))->toBeFalse()
        ->and(Authenticate::dummyHash())->toBe($dummy);
});

it('makes a new dummy hash when the hasher changes', function () {
    $bcrypt = Authenticate::dummyHash();
    config(['hashing.bcrypt.rounds' => 5]);

    expect(Authenticate::dummyHash())->not->toBe($bcrypt)
        ->and(Hash::needsRehash(Authenticate::dummyHash()))->toBeFalse();
});

it('refuses known and unknown addresses alike with argon2id as the hasher', function (?string $email) {
    config(['hashing.driver' => 'argon2id']);
    User::factory()->create(['email' => 'x@example.com', 'password' => 'secret-pass']);

    expect(Hash::needsRehash(Authenticate::dummyHash()))->toBeFalse();
    $this->from('/login')->post('/login', ['email' => $email, 'password' => 'wrong-pass'])
        ->assertRedirect('/login')->assertSessionHasErrors(['email' => __('auth.failed')]);
    $this->from('/login')->post('/login', ['email' => 'x@example.com', 'password' => 'secret-pass'])->assertRedirect('/my-items');
})->with(['known' => 'x@example.com', 'unknown' => 'nobody@example.com']);

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

it('registers only the routes of sign-in, sign-out and password reset', function () {
    $auth = collect(Route::getRoutes()->getRoutes())
        ->filter(fn (RoutingRoute $route) => str_starts_with($route->getActionName(), 'Laravel\\Fortify\\') || str_starts_with($route->getActionName(), 'App\\Http\\Controllers\\Auth\\'))
        ->map(fn (RoutingRoute $route) => $route->getName())->sort()->values()->all();

    expect($auth)->toBe(['login', 'login.store', 'logout', 'password.email', 'password.request', 'password.reset', 'password.update'])
        ->and(collect(Route::getRoutes()->getRoutes())->filter(fn (RoutingRoute $route) => str_starts_with($route->uri(), 'user/'))->all())->toBe([]);
});

it('has no password confirmation of Fortify', function () {
    $this->actingAs(User::factory()->create(['password' => 'secret-pass']));

    $this->get('/user/confirm-password')->assertNotFound();
    $this->get('/user/confirmed-password-status')->assertNotFound();
    $this->post('/user/confirm-password', ['password' => 'secret-pass'])->assertStatus(405);
});
