<?php

use App\Mcp\Support\Output;
use Illuminate\Support\Str;
use Tests\Feature\Access\MatrixWorld;
use Tests\Support\Mcp\McpClient;
use Tests\Support\Mcp\ToolRows;
use Tests\Support\Mcp\TwinServer;
use Tests\Support\OpenApi\Contract;
use Tests\Support\OpenApi\Document;

/*
 * MCP answers what REST answers (phase 13, task 3b; K6, K7): a read tool gives the body of its twin for the same token
 * in the same world, without `links` and with rich text as Markdown, `meta.path` included; a write tool answers in the
 * shape its twin documents (without `links`, the `_json` forms and `values_markdown`, which the result leaves out), a
 * refusal in the shape of its problem. The rows: tools.php and twins.php.
 */

beforeEach(fn () => TwinServer::serve());

it('reads what REST reads', function (string $suite, string $key) {
    $w = MatrixWorld::build();
    [$tool, $action] = ToolRows::action($suite, $key);
    expect($action->twin)->toBeString("{$key} reads without a REST twin");

    $plain = apiToken($w->account('org_admin'), ['read', 'write', 'mcp']);
    $arguments = ToolRows::arguments($suite, $key, $w);
    $args = ToolRows::read($arguments)->withDefaults($action);
    [$method] = ToolRows::twin($action);
    $url = (string) $action->twinPath($args);

    $rest = $method === 'GET'
        ? $this->getJson($url.'?'.http_build_query($args->query(array_values(array_diff(array_keys($action->parameters), ToolRows::pathArguments($action))))), ['Authorization' => 'Bearer '.$plain])
        : $this->json($method, $url, $args->input(), ['Authorization' => 'Bearer '.$plain]);
    $rest->assertSuccessful();
    $body = json_decode((string) $rest->getContent(), true);
    unset($body['links']);

    $result = McpClient::for($this, $plain, path: ToolRows::path($suite))->call($tool->name(), $arguments);

    expect($result['isError'])->toBeFalse((string) json_encode($result))
        // `meta.path` of a list included: the path of the twin, not of /mcp
        ->and($result['structuredContent'])->toBe(Output::markdown($body));
})->with(ToolRows::dataset(write: false));

it('answers writes in the shape of their twin', function (string $suite, string $key) {
    $w = MatrixWorld::build();
    [$tool, $action] = ToolRows::action($suite, $key);
    $arguments = ToolRows::arguments($suite, $key, $w);

    $response = McpClient::for($this, apiToken($w->account('org_admin'), ['read', 'write', 'mcp']), path: ToolRows::path($suite))
        ->rpc('tools/call', ['name' => $tool->name(), 'arguments' => (object) $arguments])
        ->assertOk();
    $result = json_decode((string) $response->getContent())->result;

    if ($action->twin === null) {
        expect($result->isError)->toBeFalse((string) $response->getContent());

        return;
    }

    [$method, $uri] = ToolRows::twin($action);
    // a refusal is a problem of its status, a success the answer of the first success of the twin
    $status = $result->isError
        ? $result->structuredContent->status
        : (int) collect(array_keys(Document::operation($method, $uri)['responses']))->first(fn (int|string $status) => Str::startsWith((string) $status, '2'));

    if ($status === 204) {
        expect($result->structuredContent)->toEqual((object) ['done' => true]);

        return;
    }

    $body = $result->structuredContent;
    unset($body->retry_after);
    expect(Contract::conforms($method, $uri, $status, $body, ['links', '*_json', 'values_markdown']))->toBe([], "{$key} {$status}: ".json_encode($body));
})->with(ToolRows::dataset(write: true));
