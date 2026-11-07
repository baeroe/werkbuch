<?php

use App\Mcp\Support\McpResult;
use App\Mcp\Support\Output;

/*
 * Rich text in the result of a tool only as Markdown (phase 13, task 3a; K7): the JSON form goes where the Markdown
 * stands next to it, rich text values take their Markdown, objects stay objects.
 */

/** The structured content of a result with the body, as the JSON the client receives. */
$sent = fn (array|stdClass $body): string => (string) json_encode(McpResult::body($body)->toResponse()->getStructuredContent(), JSON_UNESCAPED_SLASHES);

it('drops the json form next to markdown', function () {
    $doc = ['type' => 'doc', 'content' => []];

    expect(Output::markdown([
        'description' => '**a**', 'description_json' => $doc,
        'comments' => [['body' => 'b', 'body_json' => $doc], ['body' => null, 'body_json' => null]],
    ]))->toBe(['description' => '**a**', 'comments' => [['body' => 'b'], ['body' => null]]]);
});

it('puts the markdown of rich text values into values', function () {
    $doc = ['type' => 'doc', 'content' => []];

    expect(Output::markdown(['data' => [
        'values' => ['effort' => 3, 'notes' => $doc],
        'values_markdown' => ['notes' => '- eins'],
    ]]))->toBe(['data' => ['values' => ['effort' => 3, 'notes' => '- eins']]]);

    // as objects, the way a result decodes its body
    $object = Output::markdown(json_decode('{"values": {"effort": 3, "notes": {"type": "doc"}}, "values_markdown": {"notes": "- eins"}}'));
    expect($object)->toBeInstanceOf(stdClass::class)
        ->and(json_encode($object))->toBe('{"values":{"effort":3,"notes":"- eins"}}');
});

it('keeps a _json key without a sibling', function () {
    $doc = ['type' => 'doc'];

    expect(Output::markdown(['description_json' => $doc, 'title' => 'x']))->toBe(['description_json' => $doc, 'title' => 'x'])
        // values_markdown without values stays too
        ->and(Output::markdown(['values_markdown' => ['a' => 'b']]))->toBe(['values_markdown' => ['a' => 'b']])
        ->and(Output::markdown([1, 'two', null]))->toBe([1, 'two', null]);
});

it('keeps an empty values object an object', function () use ($sent) {
    expect($sent(json_decode('{"data": {"values": {}, "values_markdown": {}, "labels": []}}')))
        ->toBe('{"data":{"values":{},"labels":[]}}')
        ->and($sent(['data' => ['values' => new stdClass, 'values_markdown' => new stdClass]]))->toBe('{"data":{"values":{}}}');
});

it('answers what REST answers with 204 as done', function () use ($sent) {
    expect($sent(['ok' => 1]))->toBe('{"ok":1}')
        ->and(json_encode(McpResult::done()->toResponse()->getStructuredContent()))->toBe('{"done":true}')
        // at() changes only a list
        ->and(json_encode(McpResult::done()->at('/somewhere')->toResponse()->getStructuredContent()))->toBe('{"done":true}');
});
