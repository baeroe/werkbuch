<?php

use App\Http\Api\RateKey;
use App\Models\User;
use App\Providers\ApiServiceProvider;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/*
 * The limit of /api/v1 (A387, K9): per valid token, else per account of the session (with a limit of its own), else per
 * address. It runs before auth, so what fails auth counts as well, at the address. The clock stands still: a minute that
 * ends in the middle of a test would hand out a new quota.
 */

beforeEach(function () {
    config(['werkbuch.rate_limits.api' => 3, 'werkbuch.rate_limits.api_session' => 5]);
    $this->freezeTime();
});

/** `GET /api/v1/organization` with a token (or none) from an address; every call starts without the account of the last. */
$get = function (TestCase $test, ?string $token = null, string $ip = '203.0.113.7'): TestResponse {
    forgetApiAuth();

    return $test->flushHeaders()->withServerVariables(['REMOTE_ADDR' => $ip])
        ->getJson('/api/v1/organization', $token === null ? [] : ['Authorization' => 'Bearer '.$token]);
};

it('answers 429 with Retry-After after the limit of a token', function () use ($get) {
    $token = apiToken(User::factory()->create(['locale' => 'de']), ['read']);

    foreach ([2, 1, 0] as $left) {
        $get($this, $token)->assertOk()->assertHeader('X-RateLimit-Limit', '3')->assertHeader('X-RateLimit-Remaining', (string) $left);
    }

    $get($this, $token)->assertStatus(429)
        ->assertHeader('Content-Type', 'application/problem+json')
        ->assertHeader('X-RateLimit-Limit', '3')
        ->assertHeader('X-RateLimit-Remaining', '0')
        ->assertHeader('Retry-After', '60')
        ->assertJsonPath('reason', 'too_many_requests')
        // in the language of the account (SetLocale:api runs before the throttle)
        ->assertJsonPath('title', 'Zu viele Anfragen')
        ->assertJsonPath('detail', 'Zu viele Anfragen. Versuch es gleich noch einmal.');
});

it('counts two tokens of one account apart', function () use ($get) {
    $user = User::factory()->create();
    [$first, $second] = [apiToken($user, ['read']), apiToken($user, ['read'])];

    foreach (range(1, 3) as $ignored) {
        $get($this, $first)->assertOk();
    }

    $get($this, $first)->assertStatus(429);
    $get($this, $second)->assertOk()->assertHeader('X-RateLimit-Remaining', '2');
});

it('counts the session per account, not per address, with the limit of the session', function () use ($get) {
    [$mara, $lene] = [User::factory()->create(), User::factory()->create()];
    // the guard of the session by name: after a request of the API Laravel's default guard in the test is `sanctum`

    // the session has its own, higher limit (K9): 5, where a token or an address has 3
    foreach ([4, 3, 2, 1, 0] as $left) {
        forgetApiAuth();
        $this->actingAs($mara, 'web')->withServerVariables(['REMOTE_ADDR' => '203.0.113.7'])->getJson('/api/v1/organization')
            ->assertOk()->assertHeader('X-RateLimit-Limit', '5')->assertHeader('X-RateLimit-Remaining', (string) $left);
    }
    forgetApiAuth();
    $this->actingAs($mara, 'web')->getJson('/api/v1/organization')->assertStatus(429)->assertHeader('X-RateLimit-Limit', '5');

    // another account in the same office (one address behind NAT) has its own quota
    forgetApiAuth();
    $this->actingAs($lene, 'web')->getJson('/api/v1/organization')->assertOk()->assertHeader('X-RateLimit-Remaining', '4');
    // and the address itself was never spent
    $get($this)->assertUnauthorized()->assertHeader('X-RateLimit-Limit', '3')->assertHeader('X-RateLimit-Remaining', '2');
});

it('knows the account of a real session before auth runs', function () {
    config(['session.driver' => 'database']);
    User::factory()->create(['email' => 'lene@example.com', 'password' => 'lene-password']);

    $login = $this->post('/login', ['email' => 'lene@example.com', 'password' => 'lene-password']);
    $session = (string) $login->getCookie(config('session.cookie'))?->getValue();
    forgetApiAuth();

    // the interface: the session cookie from the page it runs on (Sanctum stateful); the limit of the session, not of the address
    $this->withCookie(config('session.cookie'), $session)->withHeader('Referer', config('app.url'))
        ->getJson('/api/v1/organization')->assertOk()->assertHeader('X-RateLimit-Limit', '5');
});

it('counts an unknown, an expired and a revoked token per address', function (Closure $token) use ($get) {
    $plain = $token();

    foreach ([2, 1, 0] as $left) {
        $get($this, $plain)->assertUnauthorized()->assertHeader('X-RateLimit-Remaining', (string) $left);
    }

    $get($this, $plain)->assertStatus(429);
    // the same address without any token shares the quota
    $get($this)->assertStatus(429);
    // another address does not
    $get($this, $plain, '198.51.100.4')->assertUnauthorized();
})->with([
    'unknown' => [fn () => '01jzzzzzzzzzzzzzzzzzzzzzzz|wb_nothing'],
    'without an id' => [fn () => 'wb_nothing'],
    'expired' => [fn () => User::factory()->create()->createToken('old', ['read'], now()->subMinute())->plainTextToken],
    'revoked' => [function () {
        $token = User::factory()->create()->createToken('gone', ['read']);
        $token->accessToken->delete();

        return $token->plainTextToken;
    }],
    'a wrong secret' => [fn () => explode('|', apiToken(User::factory()->create(), ['read']))[0].'|wb_wrong'],
]);

it('never spends the quota of a valid token on them', function () use ($get) {
    $token = apiToken(User::factory()->create(), ['read']);

    foreach (range(1, 4) as $ignored) {
        $get($this, 'wb_nothing');
    }

    $get($this, 'wb_nothing')->assertStatus(429);
    $get($this, $token)->assertOk()->assertHeader('X-RateLimit-Remaining', '2');
});

it('counts a token of a disabled account per token, which then fails at the account', function () use ($get) {
    $user = User::factory()->create();
    $token = $user->createToken('kept', ['read']);
    // a token outlives the account only when somebody writes the column (DeactivateUser deletes the tokens)
    $user->forceFill(['disabled_at' => now()])->save();

    expect(RateKey::for(Request::create('/api/v1/organization', server: ['HTTP_AUTHORIZATION' => 'Bearer '.$token->plainTextToken])))
        ->toBe('token:'.$token->accessToken->getKey());

    $get($this, $token->plainTextToken)->assertUnauthorized()->assertHeader('X-RateLimit-Remaining', '2');
    // the address keeps its quota
    $get($this, 'wb_nothing')->assertHeader('X-RateLimit-Remaining', '2');
});

it('names the key of a request: token, else account of the session, else address', function () {
    $user = User::factory()->create();
    $token = $user->createToken('t', ['read']);
    $request = fn (array $server = []) => Request::create('/api/v1/organization', server: ['REMOTE_ADDR' => '203.0.113.9', ...$server]);

    expect(RateKey::for($request(['HTTP_AUTHORIZATION' => 'Bearer '.$token->plainTextToken])))->toBe('token:'.$token->accessToken->getKey())
        ->and(RateKey::for($request()))->toBe('ip:203.0.113.9');

    $this->actingAs($user);
    // a token goes before the session
    expect(RateKey::for($request(['HTTP_AUTHORIZATION' => 'Bearer '.$token->plainTextToken])))->toBe('token:'.$token->accessToken->getKey())
        ->and(RateKey::for($request()))->toBe('user:'.$user->id)
        ->and(RateKey::for($request(['HTTP_AUTHORIZATION' => 'Bearer wb_nothing'])))->toBe('user:'.$user->id);
});

it('counts the requests a route throttle refuses too, and keeps the headers of the API', function () {
    config(['werkbuch.rate_limits.api' => 5]);
    // the route throttle of the uploads, lowered: one request a minute
    RateLimiter::for('attachments', fn (Request $request) => Limit::perMinute(1)->by(RateKey::account($request)));
    $token = apiToken(User::factory()->create(), ['read', 'write']);
    $post = fn () => $this->withToken($token)->postJson('/api/v1/attachments', []);

    // through both throttles: the action refuses the empty form; the headers are the API's (P2), not the route's 1/0
    $post()->assertUnprocessable()->assertHeader('X-RateLimit-Limit', '5')->assertHeader('X-RateLimit-Remaining', '4');
    // the route throttle refuses: only Retry-After says which throttle it was
    $post()->assertStatus(429)
        ->assertJsonPath('reason', 'too_many_requests')
        ->assertHeader('Retry-After', '60')
        ->assertHeader('X-RateLimit-Limit', '5')
        ->assertHeader('X-RateLimit-Remaining', '3')
        ->assertHeaderMissing('X-RateLimit-Reset');

    // the refused request counted at the API
    $this->withToken($token)->getJson('/api/v1/organization')->assertOk()->assertHeader('X-RateLimit-Remaining', '2');
});

it('keys the throttles of single routes per account, for a token as for the session', function (string $limiter) {
    [$mara, $lene] = [User::factory()->create(), User::factory()->create()];
    $request = fn (?string $token = null) => Request::create('/api/v1/attachments', 'POST', server: ['REMOTE_ADDR' => '203.0.113.9', ...($token === null ? [] : ['HTTP_AUTHORIZATION' => 'Bearer '.$token])]);
    $key = fn (Request $request) => RateLimiter::limiter($limiter)($request)->key;

    // two tokens of Mara share her quota, Lene has her own; before auth `$request->user()` knew none of them
    expect($key($request(apiToken($mara, ['write']))))->toBe('user:'.$mara->id)
        ->and($key($request(apiToken($mara, ['write']))))->toBe('user:'.$mara->id)
        ->and($key($request(apiToken($lene, ['write']))))->toBe('user:'.$lene->id)
        ->and($key($request('wb_nothing')))->toBe('ip:203.0.113.9');

    $this->actingAs($lene, 'web');
    expect($key($request()))->toBe('user:'.$lene->id)
        ->and(RateKey::account($request(apiToken($mara, ['write']))))->toBe('user:'.$mara->id);
})->with(['attachments', 'webhook-send', 'test-mail']);

it('throttles the docs per address, with or without a token', function () {
    $token = apiToken(User::factory()->create(), ['read']);
    $docs = fn (string $ip, array $headers = []) => $this->withServerVariables(['REMOTE_ADDR' => $ip])->get('/api/docs', $headers);

    foreach (range(1, ApiServiceProvider::DOCS_PER_MINUTE) as $ignored) {
        $docs('203.0.113.7')->assertOk();
    }

    $docs('203.0.113.7')->assertStatus(429);
    // a token is no way around the limit of the address: generating the document is the costly part (K5)
    $docs('203.0.113.7', ['Authorization' => 'Bearer '.$token])->assertStatus(429);
    $docs('198.51.100.4')->assertOk();
});

it('takes the limits from the configuration', function () {
    config(['werkbuch.rate_limits.api' => 7, 'werkbuch.rate_limits.api_session' => 11]);
    $limiter = RateLimiter::limiter('api');
    $user = User::factory()->create();

    $address = $limiter(Request::create('/api/v1/organization', server: ['REMOTE_ADDR' => '203.0.113.9']));
    $this->actingAs($user);
    $session = $limiter(Request::create('/api/v1/organization'));

    expect([$address->maxAttempts, $address->decaySeconds, $address->key])->toBe([7, 60, 'ip:203.0.113.9'])
        ->and([$session->maxAttempts, $session->key])->toBe([11, 'user:'.$user->id]);
});
