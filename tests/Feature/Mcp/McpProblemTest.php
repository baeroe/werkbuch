<?php

use App\Exceptions\Problem;
use App\Http\Api\ProblemResponse;
use App\Mcp\Support\McpProblem;
use App\Models\User;
use Illuminate\Contracts\Debug\ExceptionHandler;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Exceptions;
use Tests\Support\Mcp\McpClient;
use Tests\Support\Mcp\TestServer;
use Tests\TestCase;

/*
 * Exceptions in a tool (phase 13, task 3a; K5): a result with isError, a line with status, reason and sentence, a line
 * per field error, and the problem of REST as structuredContent, reported and rendered by Laravel's exception handler.
 */

beforeEach(fn () => TestServer::serve());

$throw = fn (TestCase $t, string $kind, ?User $user = null): array => McpClient::for($t, apiToken($user ?? User::factory()->create(), ['read', 'mcp']), path: '/'.TestServer::PATH)
    ->call('echo', ['action' => 'throw', 'kind' => $kind]);

/** The body REST answers for the exception, as JSON with arrays. */
$rest = fn (Throwable $e): array => json_decode((string) ProblemResponse::from($e, (bool) config('app.debug'))->getContent(), true);

it('answers a problem like REST', function () use ($throw, $rest) {
    config(['app.debug' => false]);
    Exceptions::fake();
    $result = $throw($this, 'conflict');

    expect($result['isError'])->toBeTrue()
        ->and($result['content'])->toBe([['type' => 'text', 'text' => '409 transition_not_allowed: Not from here.']])
        ->and($result['structuredContent'])->toBe($rest(Problem::conflict('transition_not_allowed', ['states' => []], 'Not from here.')))
        ->and($result['structuredContent']['states'])->toBe([]);
    Exceptions::assertNothingReported();
});

it('answers in the language of the account', function () use ($throw) {
    $result = $throw($this, 'missing', User::factory()->create(['locale' => 'de']));

    $title = __('problem.title.not_found', [], 'de');

    expect($title)->not->toBe(__('problem.title.not_found', [], 'en'))
        ->and($result['content'][0]['text'])->toBe('404 not_found: '.$title)
        ->and($result['structuredContent']['title'])->toBe($title);
});

it('lists the field errors', function () use ($throw) {
    $result = $throw($this, 'invalid');

    expect($result['content'][0]['text'])->toBe(implode("\n", [
        '422 validation_failed: '.__('problem.reason.validation_failed'),
        'title: The title is too long.',
        'title: The title is odd.',
        'due_date: No day.',
    ]))
        ->and($result['structuredContent']['errors'])->toBe(['title' => ['The title is too long.', 'The title is odd.'], 'due_date' => ['No day.']]);
});

it('answers a ModelNotFoundException with 404 like REST', function () use ($throw) {
    Exceptions::fake();
    $result = $throw($this, 'missing');

    expect($result['isError'])->toBeTrue()
        ->and($result['content'][0]['text'])->toBe('404 not_found: '.__('problem.title.not_found'))
        ->and($result['structuredContent'])->toBe([
            'type' => 'urn:werkbuch:problem:not_found',
            'title' => __('problem.title.not_found'),
            'status' => 404,
            'reason' => 'not_found',
        ]);
    Exceptions::assertNothingReported();
});

it('does not report a 409', function () use ($throw) {
    Exceptions::fake();

    expect($throw($this, 'conflict')['structuredContent']['status'])->toBe(409);
    Exceptions::assertNothingReported();
});

it('does not report search_unavailable', function () use ($throw) {
    Exceptions::fake();
    $result = $throw($this, 'search');

    expect($result['content'][0]['text'])->toStartWith('503 search_unavailable: ')
        ->and($result['structuredContent']['reason'])->toBe('search_unavailable');
    Exceptions::assertNothingReported();
});

it('hides a crash and reports it', function () use ($throw) {
    config(['app.debug' => false]);
    Exceptions::fake();
    $result = $throw($this, 'crash');

    expect($result['content'][0]['text'])->toBe('500 server_error: '.__('problem.reason.server_error'))
        ->and($result['content'][0]['text'])->not->toContain('secret')
        ->and((string) json_encode($result['structuredContent']))->not->toContain('secret')
        ->and($result['structuredContent']['reason'])->toBe('server_error');
    Exceptions::assertReported(fn (RuntimeException $e) => $e->getMessage() === 'secret');
});

it('shows the crash while debugging', function () use ($throw) {
    config(['app.debug' => true]);
    Exceptions::fake();

    expect($throw($this, 'crash')['content'][0]['text'])->toBe('500 server_error: secret');
});

it('says when to retry', function () use ($throw) {
    $result = $throw($this, 'throttle');

    expect($result['content'][0]['text'])->toStartWith('429 too_many_requests: ')
        ->and($result['structuredContent']['status'])->toBe(429)
        ->and($result['structuredContent']['retry_after'])->toBe(42);
});

it('gives rich text in a problem as markdown', function () {
    $this->app->instance('request', Request::create('/mcp', 'POST'));
    $e = Problem::conflict('description_conflict', ['current' => ['description' => '**neu**', 'description_json' => ['type' => 'doc']]]);

    $body = McpProblem::response($e)->getStructuredContent();

    // the same exception renders the JSON form over REST
    expect(json_decode((string) app(ExceptionHandler::class)->render(Request::create('/api/v1/x'), $e)->getContent(), true)['current'])
        ->toHaveKey('description_json')
        ->and((array) $body['current'])->toBe(['description' => '**neu**']);
});
