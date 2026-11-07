<?php

use App\Search\MeilisearchEngine;
use GuzzleHttp\Client as Guzzle;
use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Psr7\Response;
use Meilisearch\Client;
use Meilisearch\Exceptions\ApiException;

/** An engine whose Meilisearch answers with these responses, one after the other. */
$engineAnswering = function (Response ...$responses): MeilisearchEngine {
    $http = new Guzzle(['handler' => HandlerStack::create(new MockHandler($responses)), 'http_errors' => false]);

    return new MeilisearchEngine(new Client('http://meili.test', null, $http), false, new Client('http://meili.test', null, $http));
};

it('describes the documents of an index from its stats: how many, and how many hold each field', function () use ($engineAnswering) {
    $engine = $engineAnswering(new Response(200, ['Content-Type' => 'application/json'], '{"numberOfDocuments": 7, "isIndexing": false, "fieldDistribution": {"id": 7, "name": 5}}'));

    expect($engine->documentStats('work_items'))->toBe(['documents' => 7, 'fields' => ['id' => 7, 'name' => 5]]);
});

it('describes a missing index as empty and lets every other error fly', function () use ($engineAnswering) {
    $missing = $engineAnswering(new Response(404, ['Content-Type' => 'application/json'], '{"message": "Index not found", "code": "index_not_found", "type": "invalid_request", "link": ""}'));
    $broken = $engineAnswering(new Response(500, ['Content-Type' => 'application/json'], '{"message": "boom", "code": "internal", "type": "internal", "link": ""}'));

    expect($missing->documentStats('work_items'))->toBe(['documents' => 0, 'fields' => []])
        ->and(fn () => $broken->documentStats('work_items'))->toThrow(ApiException::class);
});
