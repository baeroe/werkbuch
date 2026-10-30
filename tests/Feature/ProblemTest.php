<?php

use App\Exceptions\Problem;
use App\Models\User;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Contracts\Debug\ExceptionHandler;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\Exceptions\ThrottleRequestsException;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Session\TokenMismatchException;
use Illuminate\Support\Facades\Route;

function apiRoute(string $method, string $uri, Closure $action): void
{
    Route::middleware('api')->prefix('api/v1')->{$method}($uri, $action);
}

it('renders a Problem as application/problem+json', function () {
    apiRoute('get', '_t/conflict', fn () => throw Problem::conflict('description_conflict', ['current' => ['id' => 'x']]));

    $this->getJson('api/v1/_t/conflict')->assertStatus(409)
        ->assertHeader('Content-Type', 'application/problem+json')
        ->assertExactJson([
            'type' => 'urn:werkbuch:problem:description_conflict', 'title' => __('problem.title.conflict'),
            'status' => 409, 'detail' => __('problem.reason.description_conflict'),
            'reason' => 'description_conflict', 'current' => ['id' => 'x'],
        ]);
});

it('keeps the explanation of a Problem and lets extensions never overwrite the core members', function () {
    apiRoute('get', '_t/forbidden', fn () => throw Problem::forbidden('Only owners may do this.'));
    apiRoute('get', '_t/greedy', fn () => throw Problem::conflict('conflict', ['status' => 200, 'extra' => true]));

    $this->getJson('api/v1/_t/forbidden')->assertForbidden()->assertJsonPath('detail', 'Only owners may do this.');
    $this->getJson('api/v1/_t/greedy')->assertStatus(409)->assertJsonPath('status', 409)->assertJsonPath('extra', true);
});

it('renders validation errors as 422 validation_failed with errors by path', function () {
    apiRoute('post', '_t/validate', fn (Request $r) => $r->validate(['title' => 'required']));

    $this->postJson('api/v1/_t/validate', [])->assertStatus(422)
        ->assertJsonPath('reason', 'validation_failed')
        ->assertJsonPath('detail', __('problem.reason.validation_failed'))
        ->assertJsonPath('errors.title.0', __('validation.required', ['attribute' => 'title']));
});

it('maps framework exceptions to reasons with the translated detail, never the framework message', function (Closure $throw, int $status, string $reason) {
    config(['app.debug' => false]);
    apiRoute('get', '_t/x', $throw);

    $response = $this->getJson('api/v1/_t/x')->assertStatus($status)->assertJsonPath('reason', $reason)
        ->assertJsonPath('type', 'urn:werkbuch:problem:'.$reason)->assertHeader('Content-Type', 'application/problem+json');

    if ($status === 404) {
        $response->assertJsonMissingPath('detail');
    } else {
        $response->assertJsonPath('detail', __('problem.reason.'.$reason));
    }
})->with([
    'auth' => [fn () => throw new AuthenticationException, 401, 'unauthenticated'],
    'policy' => [fn () => throw new AuthorizationException, 403, 'forbidden'],
    'model' => [fn () => throw (new ModelNotFoundException)->setModel(User::class), 404, 'not_found'],
    'abort 404' => [fn () => abort(404), 404, 'not_found'],
    'csrf' => [fn () => throw new TokenMismatchException, 419, 'csrf_token_mismatch'],
    'throttle' => [fn () => throw new ThrottleRequestsException(headers: ['Retry-After' => 30]), 429, 'too_many_requests'],
    'method' => [fn () => abort(405), 405, 'method_not_allowed'],
    'bad request' => [fn () => abort(400, 'framework text'), 400, 'bad_request'],
    'other http' => [fn () => abort(418), 418, 'http_error'],
    'crash' => [fn () => throw new LogicException('secret internals'), 500, 'server_error'],
]);

it('hides internals of 5xx unless debugging', function () {
    apiRoute('get', '_t/crash', fn () => throw new LogicException('secret internals'));
    apiRoute('get', '_t/unavailable', fn () => abort(503, 'secret maintenance details'));

    config(['app.debug' => false]);
    $this->getJson('api/v1/_t/crash')->assertStatus(500)->assertJsonPath('detail', __('problem.reason.server_error'));

    config(['app.debug' => true]);
    $this->getJson('api/v1/_t/crash')->assertStatus(500)->assertJsonPath('detail', 'secret internals');
    // an HTTP exception's own message is framework text: it stays out, debug or not
    $this->getJson('api/v1/_t/unavailable')->assertStatus(503)->assertJsonPath('detail', __('problem.reason.service_unavailable'));
});

it('keeps framework messages out of the body, also the route list of a 405', function () {
    apiRoute('get', '_t/only-get', fn () => 'ok');

    $response = $this->postJson('api/v1/_t/only-get')->assertStatus(405)
        ->assertJsonPath('detail', __('problem.reason.method_not_allowed'));

    expect($response->getContent())->not->toContain('only-get')->and($response->getContent())->not->toContain('GET');
});

it('answers 400 with the translated detail for a foreign Host', function () {
    config(['app.url' => 'https://pm.example.com']);
    $this->app['env'] = 'production';

    try {
        $this->getJson('http://evil.example.net/api/v1/anything')->assertStatus(400)
            ->assertJsonPath('reason', 'bad_request')->assertJsonPath('detail', __('problem.reason.bad_request'));
    } finally {
        Request::setTrustedHosts([]);
    }
});

it('translates the detail into the request locale', function () {
    apiRoute('get', '_t/forbidden', fn () => throw new AuthorizationException('English framework text'));

    app()->setLocale('de');
    $this->getJson('api/v1/_t/forbidden')->assertForbidden()->assertJsonPath('detail', 'Dafür fehlt die Berechtigung.');
});

it('rejects a reason without translation', function () {
    expect(fn () => Problem::conflict('made_up'))->toThrow(InvalidArgumentException::class, 'made_up')
        ->and(fn () => Problem::locked('made_up'))->toThrow(InvalidArgumentException::class)
        ->and(fn () => new Problem(409, 'made_up'))->toThrow(InvalidArgumentException::class);
});

it('never gives a 404 a detail', function () {
    apiRoute('get', '_t/model', fn () => throw (new ModelNotFoundException)->setModel(User::class, ['secret-id']));
    apiRoute('get', '_t/problem', fn () => throw Problem::notFound());

    $this->getJson('api/v1/_t/model')->assertNotFound()->assertJsonMissingPath('detail');
    $this->getJson('api/v1/_t/problem')->assertNotFound()->assertJsonMissingPath('detail')->assertJsonPath('reason', 'not_found');
});

it('sends Retry-After with 429', function () {
    apiRoute('get', '_t/throttle', fn () => throw new ThrottleRequestsException(headers: ['Retry-After' => 30]));

    $this->getJson('api/v1/_t/throttle')->assertStatus(429)->assertHeader('Retry-After', '30');
});

it('answers an unknown route below /api/v1 as a 404 problem', function () {
    $this->getJson('api/v1/nothing-here')->assertNotFound()->assertHeader('Content-Type', 'application/problem+json');
});

it('leaves responses an exception already carries alone', function () {
    apiRoute('get', '_t/early', fn () => throw new HttpResponseException(new Response('early', 202)));

    $this->getJson('api/v1/_t/early')->assertStatus(202)->assertSee('early');
});

it('leaves web routes to Laravel', function () {
    Route::get('_t/forbidden', fn () => throw Problem::forbidden());

    $response = $this->get('_t/forbidden')->assertForbidden();
    expect((string) $response->headers->get('Content-Type'))->not->toContain('problem+json');
});

it('does not report refusals below 500', function () {
    $handler = app(ExceptionHandler::class);

    expect($handler->shouldReport(Problem::forbidden()))->toBeFalse()
        ->and($handler->shouldReport(new Problem(500, 'server_error')))->toBeTrue();
});

it('has the factories of the contract', function () {
    expect(Problem::forbidden()->status)->toBe(403)->and(Problem::forbidden()->getStatusCode())->toBe(403)
        ->and(Problem::forbidden()->getHeaders())->toBe([])
        ->and(Problem::notFound()->status)->toBe(404)->and(Problem::notFound()->detail)->toBeNull()
        ->and(Problem::locked('archived')->status)->toBe(409)->and(Problem::locked('archived')->reason)->toBe('archived')
        ->and(Problem::invalid(['title' => ['required']])->reason)->toBe('validation_failed')
        ->and(Problem::invalid(['title' => ['required']])->errors)->toBe(['title' => ['required']]);
});

it('translates every reason and title in both languages', function () {
    $slugs = ['bad_request', 'unauthenticated', 'forbidden', 'not_found', 'method_not_allowed', 'conflict', 'payload_too_large',
        'csrf_token_mismatch', 'validation_failed', 'too_many_requests', 'server_error', 'service_unavailable', 'http_error'];
    $keys = [...array_map(fn (string $r) => 'problem.reason.'.$r, Problem::REASONS), ...array_map(fn (string $s) => 'problem.title.'.$s, $slugs)];

    foreach (['en', 'de'] as $locale) {
        $file = json_decode((string) file_get_contents(lang_path($locale.'.json')), true);
        expect($file)->toBeArray()->and(array_keys($file))->toEqualCanonicalizing($keys);
    }
});
