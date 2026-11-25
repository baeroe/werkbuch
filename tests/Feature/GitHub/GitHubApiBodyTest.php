<?php

use App\GitHub\GitHubApi;
use App\Models\GitHubApp;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;

/*
 * The bodies werkbuch sends to GitHub (WEBU-34): Laravel's HTTP client sends an empty JSON body as `[]`, and GitHub
 * refuses an array where it reads an object (422 "[] is not a null or object", the manifest conversion failed with
 * it). A write without data goes as `{}`; a write with data goes as it is.
 */

$writes = function (): array {
    return collect(Http::recorded())
        ->map(fn (array $pair) => $pair[0])
        ->filter(fn (Request $request) => $request->method() !== 'GET')
        ->map(fn (Request $request) => $request->method().' '.parse_url($request->url(), PHP_URL_PATH).' '.$request->body())
        ->values()
        ->all();
};

it('converts the manifest with an empty object, never an empty array', function () use ($writes) {
    Http::fake(['*' => Http::response(['id' => 1], 201)]);

    GitHubApi::convertManifest('abc123');

    expect($writes())->toBe(['POST /app-manifests/abc123/conversions {}']);
    Http::assertSent(fn (Request $request) => $request->body() === '{}'
        && str_starts_with($request->header('Content-Type')[0] ?? '', 'application/json'));
});

it('asks for an installation token without limits with an empty object', function () use ($writes) {
    $app = GitHubApp::factory()->create();
    Http::fake(['*' => Http::response(['token' => 'ghs_x', 'expires_at' => '2026-11-25T12:00:00Z'], 201)]);

    GitHubApi::accessToken($app, 7, null, null);

    expect($writes())->toBe(['POST /app/installations/7/access_tokens {}']);
});

it('sends a write with data as it is', function () use ($writes) {
    $app = GitHubApp::factory()->create();
    Http::fake(['*' => Http::response(['token' => 'ghs_x', 'expires_at' => '2026-11-25T12:00:00Z'], 201)]);

    GitHubApi::accessToken($app, 7, [12], ['contents' => 'write']);

    expect($writes())->toBe(['POST /app/installations/7/access_tokens {"repository_ids":[12],"permissions":{"contents":"write"}}']);
});
