<?php

use App\Webhooks\SafeTarget;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;

// A real connection (plan task 4): Mailpit is any HTTP server here; `receiver.test` is a name no DNS knows, so an
// answer can only come from the address SafeTarget checked and handed to curl
$port = fn (): int => (int) parse_url((string) env('MAILPIT_URL', 'http://127.0.0.1:8025'), PHP_URL_PORT);

beforeEach(fn () => config(['werkbuch.webhooks_allow_private' => true]));

$get = fn (string $url) => Http::withOptions([
    'curl' => [CURLOPT_RESOLVE => [SafeTarget::check($url)->curlResolve()]],
    'allow_redirects' => false,
])->get($url);

it('sends a name no DNS knows to the checked address', function () use ($port, $get) {
    resolver(['receiver.test' => ['127.0.0.1']]);

    expect($get("http://receiver.test:{$port()}/api/v1/info")->status())->toBe(200);
});

it('connects to the pinned address for a host in capitals', function () use ($port, $get) {
    resolver(['receiver.test' => ['127.0.0.1']]);

    expect($get("http://RECEIVER.Test:{$port()}/api/v1/info")->status())->toBe(200);
});

it('reaches nothing without the pinned address', function () use ($port) {
    expect(fn () => Http::get("http://receiver.test:{$port()}/api/v1/info"))
        ->toThrow(ConnectionException::class);
});
