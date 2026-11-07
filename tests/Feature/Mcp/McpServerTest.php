<?php

use App\Http\Middleware\EnsureSession;
use App\Http\Middleware\EnsureTokenAbility;
use App\Mcp\Servers\WerkbuchServer;
use App\Mcp\Support\McpAction;
use App\Mcp\Support\McpArguments;
use App\Mcp\Support\McpResult;
use App\Mcp\Support\ReadTool;
use App\Mcp\Support\ToolSchema;
use App\Mcp\Support\WerkbuchTool;
use App\Mcp\Support\WriteTool;
use App\Mcp\Tools\WhoamiTool;
use App\Models\User;
use App\OpenApi\ContentSchemas;
use App\OpenApi\ItemQueryDocs;
use App\Support\Actor;
use Illuminate\Http\Request;
use Illuminate\Routing\Route as RoutingRoute;
use Laravel\Mcp\Request as McpRequest;
use Laravel\Sanctum\TransientToken;
use Tests\Support\Mcp\McpClient;
use Tests\Support\Mcp\TestServer;
use Tests\Support\Mcp\ToolRows;
use Tests\Support\Mcp\TwinServer;

/*
 * The tools of the MCP server (phase 13, task 3a; K2, K17): registered, named and annotated alike, and offered only to
 * a personal access token with their ability. The test server (`mcp/_t`) has a read and a write tool. Task 3b: each
 * action has the ability of its REST twin (K9), and `tools/list` stays within a budget in the context of a model (K8):
 * MCP_TOOL_BYTES of JSON a tool, MCP_LIST_BYTES the whole list. A tool over it gets smaller (its description, its
 * actions), the budget does not grow.
 */

const MCP_TOOL_BYTES = 12_288;

const MCP_LIST_BYTES = 122_880;

beforeEach(function () {
    TestServer::serve();
    TwinServer::serve();
});

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
        } else {
            // a missing hint reads as true (MCP)
            expect($annotations['openWorldHint'] ?? true)->toBeTrue($name);
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
    'read and mcp' => [['read', 'mcp'], ['echo'], ['whoami', 'search', 'organization']],
    'write and mcp' => [['write', 'mcp'], ['manage-echo'], ['manage-organization']],
    'all three' => [['read', 'write', 'mcp'], ['echo', 'manage-echo'], ['whoami', 'search', 'organization', 'manage-organization']],
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

it('gives each action the ability of its twin', function (string $suite) {
    $checked = [];

    foreach (ToolRows::tools($suite) as $tool) {
        foreach ($tool->actionNames() as $name) {
            $action = $tool->actionNamed($name);
            // a read through a body (POST work-items/query) reads; an action without a twin writes
            $needed = $action->twin === null ? 'write' : EnsureTokenAbility::required(ToolRows::route($action), ToolRows::twin($action)[0]);
            $checked["{$tool->name()}:{$name}"] = $tool->ability() === $needed ? $needed : "{$tool->ability()}, but its twin needs {$needed}";
        }
    }

    // a line that is no ability names a mismatch
    expect(array_filter($checked, fn (string $line) => ! in_array($line, ['read', 'write'], true)))->toBe([])
        ->and($checked)->toMatchArray($suite === 'werkbuch' ? ['whoami:call' => 'read', 'search:call' => 'read', 'organization:get' => 'read', 'organization:state-usage' => 'read', 'manage-organization:update' => 'write', 'manage-organization:delete-workflow' => 'write'] : [
            'twins:list-users' => 'read', 'twins:members' => 'read', 'twins:query' => 'read', 'twins:groups' => 'read',
            'manage-twins:create-view' => 'write', 'manage-twins:create-label' => 'write', 'manage-twins:delete-view' => 'write',
        ]);
})->with(array_keys(ToolRows::SUITES));

it('has no twin that only the session of the browser may call', function (string $suite) {
    // REST refuses every token there in a middleware, not in the action: a tool would call the action past it
    $sessionOnly = fn (RoutingRoute $route): bool => in_array(EnsureSession::class, $route->gatherMiddleware(), true);
    $twins = [];

    foreach (ToolRows::tools($suite) as $tool) {
        foreach ($tool->actionNames() as $name) {
            $action = $tool->actionNamed($name);
            if ($action?->twin !== null) {
                $twins["{$tool->name()}:{$name}"] = $sessionOnly(ToolRows::route($action));
            }
        }
    }

    // the check sees the middleware where it stands: on creating a token and on the own account
    $route = fn (string $method, string $uri): RoutingRoute => ToolRows::route(new McpAction('x', 'x', fn () => McpResult::done(), twin: "{$method} {$uri}"));
    expect($sessionOnly($route('POST', 'tokens')))->toBeTrue()
        ->and($sessionOnly($route('PUT', 'me/password')))->toBeTrue()
        ->and($sessionOnly($route('GET', 'tokens')))->toBeFalse()
        ->and(count($twins))->toBeGreaterThan(0)
        ->and(array_keys(array_filter($twins)))->toBe([]);
})->with(array_keys(ToolRows::SUITES));

it('keeps tools/list small', function (string $suite) {
    $tools = McpClient::for($this, apiToken(User::factory()->create(), ['read', 'write', 'mcp']), path: ToolRows::path($suite))->tools();

    expect(array_column($tools, 'name'))->toBe(array_map(fn ($tool) => $tool->name(), ToolRows::tools($suite)));
    foreach ($tools as $tool) {
        expect(strlen((string) json_encode($tool)))->toBeLessThanOrEqual(MCP_TOOL_BYTES, $tool['name']);
    }
    expect(strlen((string) json_encode($tools)))->toBeLessThanOrEqual(MCP_LIST_BYTES);
})->with(array_keys(ToolRows::SUITES));

it('keeps the heaviest inputs under the tool limit', function () {
    $noop = fn (Actor $actor, McpArguments $args): McpResult => McpResult::done();
    $schema = ToolSchema::input([
        new McpAction('query', 'A page of work items by a body.', $noop, input: ItemQueryDocs::query()),
        new McpAction('groups', 'The groups of a query.', $noop, input: ItemQueryDocs::groups(), required: ['input']),
        new McpAction('counts', 'The numbers of named filters.', $noop, input: ItemQueryDocs::counts(), required: ['input']),
        new McpAction('create-view', 'Creates a view.', $noop, input: ContentSchemas::view(), required: ['input']),
    ]);

    // the four bodies and the Filter, SortSpec and Display they name, each once
    expect(array_keys($schema['$defs']))->toBe(['Display', 'Filter', 'SortSpec'])
        ->and(strlen((string) json_encode($schema)))->toBeLessThanOrEqual(MCP_TOOL_BYTES);
});
