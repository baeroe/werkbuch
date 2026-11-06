<?php

use App\Exceptions\Problem;
use App\Http\Api\ProblemResponse;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpException;

/*
 * The body of a problem (RFC 9457) as status, body and headers, which the /api routes send as a response
 * (`ProblemResponse::from`) and MCP sends as the result of a tool.
 */

it('builds the same body as the response', function (Closure $make, bool $debug, int $status) {
    $e = $make();
    [$code, $body, $headers] = ProblemResponse::body($e, $debug);
    $response = ProblemResponse::from($e, $debug);

    expect($code)->toBe($status)->and($response->getStatusCode())->toBe($status)
        ->and($response->getData(true))->toBe(json_decode((string) json_encode($body), true))
        ->and($headers['Content-Type'])->toBe('application/problem+json')
        ->and($response->headers->get('Content-Type'))->toBe('application/problem+json');

    foreach ($headers as $name => $value) {
        expect($response->headers->get($name))->toBe($value, $name);
    }
})->with([
    'a problem with extensions' => [fn () => Problem::conflict('state_in_use', ['states' => [['state_id' => 'x', 'items' => 2]]], 'In use.'), false, 409],
    'a validation' => [fn () => ValidationException::withMessages(['title' => 'Missing.']), false, 422],
    'no account' => [fn () => new AuthenticationException, false, 401],
    'an HTTP exception with headers' => [fn () => new HttpException(429, 'slow', null, ['Retry-After' => '7']), false, 429],
    'a 404 without detail' => [fn () => Problem::notFound(), false, 404],
    'a crash' => [fn () => new RuntimeException('secret'), false, 500],
    'a crash while debugging' => [fn () => new RuntimeException('secret'), true, 500],
]);

it('keeps the headers of an HTTP exception and never shows a crash', function () {
    [, $body, $headers] = ProblemResponse::body(new HttpException(429, 'slow', null, ['Retry-After' => '7']), false);
    [, $crash] = ProblemResponse::body(new RuntimeException('secret'), false);
    [, $debugged] = ProblemResponse::body(new RuntimeException('secret'), true);

    expect($headers)->toBe(['Retry-After' => '7', 'Content-Type' => 'application/problem+json'])
        ->and($body['reason'])->toBe('too_many_requests')
        ->and($crash['detail'])->toBe(__('problem.reason.server_error'))
        ->and($debugged['detail'])->toBe('secret');
});
