<?php

use App\Mcp\Servers\WerkbuchServer;
use App\Mcp\Support\ReadTool;
use App\Mcp\Support\WerkbuchTool;
use App\Mcp\Support\WriteTool;
use App\Mcp\Tools\WhoamiTool;
use App\Models\User;
use Illuminate\Http\Request;
use Laravel\Mcp\Request as McpRequest;
use Laravel\Sanctum\TransientToken;
use Tests\Support\Mcp\McpClient;
use Tests\Support\Mcp\TestServer;

/*
 * The tools of the MCP server (phase 13, task 3a; K2, K17): registered, named and annotated alike, and offered only to
 * a personal access token with their ability. The test server (`mcp/_t`) has a read and a write tool.
 */

beforeEach(fn () => TestServer::serve());

/** @return list<class-string<WerkbuchTool>> */
$registered = fn (string $server): array => (new ReflectionClass($server))->getDefaultProperties()['tools'];

it('registers every tool class', function () use ($registered) {
    $classes = collect(glob(repo_path('app/Mcp/Tools/*.php')) ?: [])
        ->map(fn (string $file) => 'App\\Mcp\\Tools\\'.basename($file, '.php'))->all();

    expect($classes)->toContain(WhoamiTool::class)
        ->and($registered(WerkbuchServer::class))->toEqualCanonicalizing($classes);

    foreach ($classes as $class) {
        $tool = app($class);
        $reflection = new ReflectionClass($class);
        $title = $reflection->getProperty('title')->getValue($tool);
        $write = $tool instanceof WriteTool;

        expect($reflection->isFinal())->toBeTrue($class)
            ->and($tool instanceof ReadTool || $write)->toBeTrue($class)
            ->and($tool->name())->toMatch('/^[a-z]+(-[a-z]+)*$/')
            // write tools are manage-… or get-upload-url, read tools never
            ->and($write)->toBe(str_starts_with($tool->name(), 'manage-') || $tool->name() === 'get-upload-url')
            ->and($title)->toMatch('/^[A-Z][a-z]*( [A-Za-z]+)*$/')
            ->and($title)->not->toMatch('/\btool\b/i')
            ->and($tool->title())->toBe($title);
    }
});

it('annotates every tool', function () use ($registered) {
    $tools = array_map(fn (string $class): WerkbuchTool => app($class), [...$registered(WerkbuchServer::class), ...$registered(TestServer::class)]);
    $writers = 0;

    foreach ($tools as $tool) {
        $annotations = $tool->annotations();
        $name = $tool->name();

        expect($annotations)->toHaveKey('readOnlyHint', message: $name);
        if ($tool->ability() === 'write') {
            $writers++;
            expect($annotations['readOnlyHint'])->toBeFalse($name)
                ->and($annotations)->toHaveKey('destructiveHint', message: $name)
                ->and($annotations['destructiveHint'])->toBeTrue($name);
        } else {
            expect($annotations['readOnlyHint'])->toBeTrue($name)
                ->and(array_keys($annotations))->not->toContain('destructiveHint');
        }

        // only manage-webhooks reaches servers outside werkbuch (pings, redeliveries)
        if ($name !== 'manage-webhooks') {
            expect($annotations)->toHaveKey('openWorldHint', message: $name)
                ->and($annotations['openWorldHint'])->toBeFalse($name);
        }
    }

    expect($writers)->toBeGreaterThan(0);
});

it('lists only the tools a token may use', function (array $abilities, array $test, array $real) {
    $user = User::factory()->create();
    $plain = apiToken($user, $abilities);

    expect(array_column(McpClient::for($this, $plain, path: '/'.TestServer::PATH)->tools(), 'name'))->toBe($test)
        ->and(array_column(McpClient::for($this, $plain)->tools(), 'name'))->toBe($real);
})->with([
    'mcp' => [['mcp'], [], []],
    'read and mcp' => [['read', 'mcp'], ['echo'], ['whoami']],
    'write and mcp' => [['write', 'mcp'], ['manage-echo'], []],
    'all three' => [['read', 'write', 'mcp'], ['echo', 'manage-echo'], ['whoami']],
]);

it('keeps every tool from a transient token', function () {
    $user = User::factory()->create();
    $http = Request::create('/mcp', 'POST');
    $http->setUserResolver(fn () => $user);
    $tool = app(WhoamiTool::class);

    // a session's TransientToken says yes to every ability, but it is no personal access token
    $user->withAccessToken(new TransientToken);
    expect($user->tokenCan('read'))->toBeTrue()
        ->and($tool->shouldRegister($http))->toBeFalse();

    // nobody at all
    $nobody = Request::create('/mcp', 'POST');
    expect($tool->shouldRegister($nobody))->toBeFalse();

    // the same account with a personal access token with read
    $user->withAccessToken($user->createToken('test', ['read', 'mcp'])->accessToken);
    expect($tool->shouldRegister($http))->toBeTrue();
});

it('refuses a hidden tool as unknown', function () {
    $mcp = McpClient::for($this, apiToken(User::factory()->create(), ['read', 'mcp']), path: '/'.TestServer::PATH);

    $mcp->rpc('tools/call', ['name' => 'manage-echo', 'arguments' => (object) []])
        ->assertStatus(400)
        ->assertJsonPath('error.code', -32602)
        ->assertJsonPath('error.message', 'Tool [manage-echo] not found.');
    // the read tool of the same token answers
    expect($mcp->call('echo', ['action' => 'done'])['structuredContent'])->toBe(['done' => true]);
});

it('refuses a tool to a transient token even past the list', function () {
    $user = User::factory()->create()->withAccessToken(new TransientToken);
    $http = Request::create('/mcp', 'POST');
    $http->setUserResolver(fn () => $user);
    $this->app->instance('request', $http);

    $response = app(WhoamiTool::class)->handle(new McpRequest);

    expect($response->responses()->sole()->isError())->toBeTrue()
        ->and($response->responses()->sole()->content()->toArray()['text'])->toBe('Tool [whoami] not found.')
        ->and($response->getStructuredContent())->toBeNull();
});

it('answers whoami like GET me', function () {
    $plain = apiToken(User::factory()->create(['locale' => 'de']), ['read', 'mcp']);

    $result = McpClient::for($this, $plain)->call('whoami');
    forgetApiAuth();
    $rest = $this->getJson('/api/v1/me', ['Authorization' => 'Bearer '.$plain])->assertOk()->json();

    expect($result['isError'])->toBeFalse()
        ->and($result['structuredContent'])->toBe($rest)
        ->and($result['structuredContent']['data']['locale'])->toBe('de')
        // the package mirrors the result as text
        ->and(json_decode($result['content'][0]['text'], true))->toBe($rest);
});

it('names the tool with a single action without an action argument', function () {
    $plain = apiToken(User::factory()->create(), ['write', 'mcp']);

    // whatever `action` says, the one action runs, as the actor of the token over MCP
    expect(McpClient::for($this, $plain, path: '/'.TestServer::PATH)->call('manage-echo', ['action' => 'nope'])['structuredContent'])
        ->toBe(['written' => 'mcp']);
});
