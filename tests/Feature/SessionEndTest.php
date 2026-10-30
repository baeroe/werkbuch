<?php

use App\Actions\Auth\EndSessions;
use App\Actions\Auth\SetPassword;
use App\Http\Middleware\EnsureAccountIsActive;
use App\Models\User;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;

it('signs out every other session after a password change, whatever the session driver', function () {
    User::factory()->create(['email' => 'lene@example.com', 'password' => 'old-password']);
    $this->post('/login', ['email' => 'lene@example.com', 'password' => 'old-password']);   // a real session, not actingAs
    $this->get('/my-items')->assertOk();                            // AuthenticateSession keeps the hash in the session

    SetPassword::run(User::query()->where('email', 'lene@example.com')->sole(), 'new-password');
    Auth::forgetGuards();                                           // the next request loads the account afresh, as a new request would

    $this->get('/my-items')->assertRedirect('/login');
    $this->assertGuest();
});

it('ends the database sessions of the account except the one it keeps', function () {
    config(['session.driver' => 'database', 'session.table' => 'sessions']);
    $user = User::factory()->create();
    foreach (['keep', 'other'] as $id) {
        DB::table('sessions')->insert(['id' => $id, 'user_id' => $user->id, 'payload' => '', 'last_activity' => time()]);
    }
    EndSessions::run($user, 'keep');
    expect(DB::table('sessions')->pluck('id')->all())->toBe(['keep']);
});

it('ends every database session of the account without one to keep, and only of this account', function () {
    config(['session.driver' => 'database', 'session.table' => 'sessions']);
    $user = User::factory()->create();
    $other = User::factory()->create();
    DB::table('sessions')->insert([
        ['id' => 'own-1', 'user_id' => $user->id, 'payload' => '', 'last_activity' => time()],
        ['id' => 'own-2', 'user_id' => $user->id, 'payload' => '', 'last_activity' => time()],
        ['id' => 'foreign', 'user_id' => $other->id, 'payload' => '', 'last_activity' => time()],
    ]);

    EndSessions::run($user);

    expect(DB::table('sessions')->pluck('id')->all())->toBe(['foreign']);
});

it('leaves the session table alone with another session driver', function () {
    config(['session.driver' => 'array']);
    $user = User::factory()->create();
    DB::table('sessions')->insert(['id' => 'own', 'user_id' => $user->id, 'payload' => '', 'last_activity' => time()]);

    EndSessions::run($user);

    expect(DB::table('sessions')->pluck('id')->all())->toBe(['own']);
});

it('signs out a disabled account on its next page and says why', function () {
    User::factory()->create(['email' => 'sven@example.com', 'password' => 'secret-pass']);
    $this->post('/login', ['email' => 'sven@example.com', 'password' => 'secret-pass']);
    $this->get('/my-items')->assertOk();

    User::query()->where('email', 'sven@example.com')->update(['disabled_at' => now()]);
    Auth::forgetGuards();

    $this->get('/my-items')->assertRedirect('/login')->assertSessionHas('error', __('errors.account_disabled'));
    $this->assertGuest();
    $this->get('/my-items')->assertRedirect('/login');
});

it('answers 401 under /api for a disabled account', function () {
    Route::middleware(['auth:sanctum', EnsureAccountIsActive::class])->get('api/v1/_t/active', fn () => ['ok' => true]);
    $active = User::factory()->create();
    $disabled = User::factory()->disabled()->create();

    $this->withToken($active->createToken('ci')->plainTextToken)->getJson('/api/v1/_t/active')->assertOk();
    Auth::forgetGuards();
    $this->withToken($disabled->createToken('ci')->plainTextToken)->getJson('/api/v1/_t/active')
        ->assertUnauthorized()->assertHeader('Content-Type', 'application/problem+json');
});
