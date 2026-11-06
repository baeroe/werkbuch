<?php

use App\Mcp\Support\RouteThrottle;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Exceptions\ThrottleRequestsException;
use Illuminate\Http\Request;
use Illuminate\Routing\Exceptions\MissingRateLimiterException;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Route;

/*
 * The throttle of a REST route over MCP (phase 13, task 3b; K16): RouteThrottle counts in the same counter as the
 * route's `throttle:<limiter>`, so REST and MCP share one quota (a ping of a webhook: six a minute, not twelve).
 */

beforeEach(function () {
    RateLimiter::for('route-throttle-test', fn (Request $request) => Limit::perMinute(2)->by('one'));
    Route::get('_t/route-throttle', fn () => 'ok')->middleware('throttle:route-throttle-test');
});

it('counts in the quota of the route throttle', function () {
    $this->get('/_t/route-throttle')->assertOk();
    RouteThrottle::hit('route-throttle-test', Request::create('/mcp', 'POST'));

    // the two of the minute are spent, over the route as through hit()
    $this->get('/_t/route-throttle')->assertStatus(429);

    try {
        RouteThrottle::hit('route-throttle-test', Request::create('/mcp', 'POST'));
        $this->fail('The third call went through.');
    } catch (ThrottleRequestsException $e) {
        expect($e->getStatusCode())->toBe(429)
            ->and((int) $e->getHeaders()['Retry-After'])->toBeGreaterThan(0)->toBeLessThanOrEqual(60);
    }
});

it('counts nothing for another limiter', function () {
    RateLimiter::for('route-throttle-other', fn (Request $request) => Limit::perMinute(1)->by('one'));
    RouteThrottle::hit('route-throttle-other', Request::create('/mcp', 'POST'));

    // the other limiter's call spent nothing of this one
    $this->get('/_t/route-throttle')->assertOk();
    $this->get('/_t/route-throttle')->assertOk();
    $this->get('/_t/route-throttle')->assertStatus(429);
});

it('refuses a limiter that is not defined', function () {
    expect(fn () => RouteThrottle::hit('route-throttle-nope', Request::create('/mcp', 'POST')))
        ->toThrow(MissingRateLimiterException::class, 'route-throttle-nope');
});
