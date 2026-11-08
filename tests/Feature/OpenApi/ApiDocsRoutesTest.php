<?php

use App\Providers\ApiServiceProvider;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Routing\Route;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Route as Router;

$docsRoutes = fn (): array => collect(Router::getRoutes()->getRoutes())
    ->filter(fn (Route $route) => in_array($route->uri(), ['api/docs', 'api/openapi.json'], true))
    ->values()->all();

it('serves the document without signing in', function () {
    $response = $this->getJson('/api/openapi.json')->assertOk()->assertHeader('Content-Type', 'application/json');

    expect($response->json('openapi'))->toStartWith('3.1')
        ->and($response->json('info.version'))->toBe(ApiServiceProvider::API_VERSION)
        ->and($response->json('info.title'))->toBe('werkbuch API')
        ->and($response->json('info.description'))->toContain('werkbuch REST API v1')
        ->and($response->json('servers'))->toBe([['url' => rtrim((string) config('app.url'), '/').'/api/v1']])
        ->and($response->json('paths'))->toHaveKey('/work-items/{item}')
        ->and($response->headers->getCookies())->toBe([]);
});

it('serves the docs page without signing in', function () {
    $response = $this->get('/api/docs')->assertOk();

    expect($response->headers->get('Content-Type'))->toStartWith('text/html')
        ->and($response->getContent())->toContain('apiDescriptionUrl="/api/openapi.json"')
        ->and($response->getContent())->toContain('/vendor/stoplight-elements/'.ApiServiceProvider::STOPLIGHT.'/web-components.min.js')
        ->and($response->headers->getCookies())->toBe([]);
});

it('serves the docs page without any third-party origin', function () {
    $html = (string) $this->get('/api/docs')->assertOk()->getContent();

    preg_match_all('~(?:https?:)?//[^\s"\'<>]+~', $html, $urls);
    $foreign = array_filter($urls[0], fn (string $url) => ! str_starts_with($url, rtrim((string) config('app.url'), '/').'/'));

    expect($foreign)->toBe([])
        ->and($html)->not->toContain('<script>')
        ->and($html)->toContain('<script src="/vendor/stoplight-elements/');
});

it('sends the CSP with the docs page', function () {
    $this->get('/api/docs')->assertOk()
        ->assertHeader('Content-Security-Policy', ApiServiceProvider::DOCS_CSP)
        ->assertHeader('X-Content-Type-Options', 'nosniff');

    expect(ApiServiceProvider::DOCS_CSP)->toBe(
        "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; "
        ."connect-src 'self'; font-src 'self'; frame-ancestors 'none'",
    );
});

it('sends the CSP with the docs page asked for with a query', function () {
    $this->get('/api/docs?foo=1')->assertOk()
        ->assertHeader('Content-Security-Policy', ApiServiceProvider::DOCS_CSP)
        ->assertHeader('X-Content-Type-Options', 'nosniff');
});

it('keeps eval out of the script of the docs page', function () {
    // script-src 'self' without 'unsafe-eval': an eval in the own script would fail in the browser
    expect(file_get_contents(public_path('api-docs.js')))->toBeString()->toContain('X-XSRF-TOKEN')->not->toContain('eval');
});

it('keeps the checked in Stoplight Elements as they came from npm', function () {
    $dir = public_path('vendor/stoplight-elements/'.ApiServiceProvider::STOPLIGHT);

    // sha256 of the files of @stoplight/elements 8.4.2 (registry tarball sha512-nJUh/fYeNKSMH8Ff…)
    expect(ApiServiceProvider::STOPLIGHT)->toBe('8.4.2')
        ->and(hash_file('sha256', $dir.'/web-components.min.js'))->toBe('6d523178b098cebc7497aeb6c5fbd55f9c9b5a13f37b8b9671a840e40bda42b9')
        ->and(hash_file('sha256', $dir.'/styles.min.css'))->toBe('ef2254a3de21204243e3cc834454930c80739cf497e9192686d9d42dad1dba7e')
        ->and(hash_file('sha256', $dir.'/LICENSE'))->toBe('d45c17f7ecc80e0deab3372ff352c7d00b7d573755c3c672088c21a376673698')
        ->and(file_exists($dir.'/web-components.min.js.LICENSE.txt'))->toBeTrue();
});

it('keeps web routes out of the document', function () {
    $paths = array_keys($this->getJson('/api/openapi.json')->assertOk()->json('paths'));

    expect($paths)->not->toBeEmpty();

    foreach ($paths as $path) {
        expect($path)->not->toStartWith('/api/')
            ->and($path)->not->toStartWith('/login')
            ->and($path)->not->toStartWith('/media/')
            ->and($path)->not->toStartWith('/broadcasting/')
            ->and($path)->not->toStartWith('/_t/')
            ->and($path)->not->toStartWith('/docs');
    }

    // the web route of a file is /attachments/{attachment} outside api/v1; the API has its own under api/v1
    expect(Router::getRoutes()->getByName('attachments.show')?->uri())->toBe('attachments/{attachment}');
});

it('exposes the docs only at api/docs and api/openapi.json', function () use ($docsRoutes) {
    $uris = collect(Router::getRoutes()->getRoutes())->map(fn (Route $route) => $route->uri());

    expect($docsRoutes())->toHaveCount(2)
        ->and($uris)->not->toContain('docs/api')
        ->and($uris)->not->toContain('docs/api.json')
        ->and($uris)->not->toContain('_scramble/dev-tools/devtools.js');
});

it('answers without the web group and without RestrictedDocsAccess outside local', function () use ($docsRoutes) {
    foreach ($docsRoutes() as $route) {
        expect($route->middleware())->toBe(['throttle:api-docs'])
            ->and($route->gatherMiddleware())->toBe(['throttle:api-docs']);
    }

    app()->detectEnvironment(fn () => 'production');

    $this->getJson('/api/openapi.json')->assertOk();
});

it('registers no dev tools route, even with debugging on', function () {
    expect(config('app.debug'))->toBeTrue()
        ->and(config('scramble.dev_tools.enabled'))->toBeFalse()
        ->and(Router::getRoutes()->getByName('scramble.dev-tools.asset'))->toBeNull();
});

it('keeps no cache of the document outside production', function () {
    expect(config('scramble.cache.store'))->toBeNull();
});

it('throttles the docs with their own limit per IP', function () {
    $limit = RateLimiter::limiter('api-docs')(Request::create('/api/docs', server: ['REMOTE_ADDR' => '203.0.113.7']));

    expect($limit)->toBeInstanceOf(Limit::class)
        ->and($limit->maxAttempts)->toBe(ApiServiceProvider::DOCS_PER_MINUTE)
        ->and(ApiServiceProvider::DOCS_PER_MINUTE)->toBe(30)
        ->and($limit->decaySeconds)->toBe(60)
        ->and($limit->key)->toBe('203.0.113.7');
});

it('refuses requests over the limit with a problem', function () {
    // one request through generates the document; the throttle refuses before generating, so only the limit is lowered
    RateLimiter::for('api-docs', fn (Request $request) => Limit::perMinute(1)->by((string) $request->ip()));

    $this->getJson('/api/openapi.json')->assertOk();
    $this->getJson('/api/openapi.json')->assertStatus(429)
        ->assertHeader('Content-Type', 'application/problem+json')
        ->assertJsonPath('reason', 'too_many_requests');
    $this->get('/api/docs')->assertStatus(429);
});
