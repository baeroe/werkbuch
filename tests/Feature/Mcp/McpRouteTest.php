<?php

use App\Http\Middleware\LimitJsonBody;
use App\Models\User;
use Illuminate\Testing\TestResponse;
use Tests\Support\Mcp\McpClient;

/*
 * The door of /mcp (phase 13, task 1; K1, K2, K3, K15): the throttle `mcp`, the language of the account, a personal
 * access token with the ability `mcp` and an active account, all before the middleware of the package; then, on the POST
 * route, a foreign Origin and a body that is no JSON are refused. Refusals before the server are problem documents.
 */

/** A token of a new account (or of the given one) with `read` and `mcp`, unless other abilities are asked for. */
$token = fn (array $abilities = ['read', 'mcp'], ?User $user = null): string => apiToken($user ?? User::factory()->create(), $abilities);

$problem = fn (TestResponse $response, int $status, string $reason): TestResponse => $response->assertStatus($status)
    ->assertHeader('Content-Type', 'application/problem+json')
    ->assertJsonPath('status', $status)
    ->assertJsonPath('reason', $reason);

it('answers server/discover with the server and its version', function () use ($token) {
    $mcp = McpClient::for($this, $token());
    $result = $mcp->discover();

    expect($result['_meta']['io.modelcontextprotocol/serverInfo'])->toBe(['name' => 'werkbuch', 'version' => config('werkbuch.version')])
        ->and($result['resultType'])->toBe('complete')
        ->and($result['supportedVersions'])->toBe(['2026-07-28'])
        ->and($result['capabilities'])->toHaveKey('tools')
        ->and($result['capabilities'])->toHaveKey('resources')
        // no prompts (P4)
        ->and(array_keys($result['capabilities']))->toBe(['tools', 'resources'])
        ->and(trim((string) $result['instructions']))->not->toBe('')
        // the read tools of a token with read (whoami since task 3a, search since task 4, organization since task 5a), no resources yet (task 11)
        ->and(array_column($mcp->tools(), 'name'))->toBe(['whoami', 'search', 'organization'])
        ->and($mcp->resources())->toBe([]);
});

it('answers initialize in the legacy handshake', function () use ($token) {
    $mcp = McpClient::for($this, $token(), McpClient::LEGACY);
    $result = $mcp->initialize('2025-11-25');

    expect($result['protocolVersion'])->toBe('2025-11-25')
        ->and($result['serverInfo'])->toBe(['name' => 'werkbuch', 'version' => config('werkbuch.version')])
        ->and(array_keys($result['capabilities']))->toBe(['tools', 'resources'])
        ->and(trim((string) $result['instructions']))->not->toBe('')
        // an older version than the package speaks over initialize gets its newest one
        ->and($mcp->initialize('2024-11-05')['protocolVersion'])->toBe('2025-11-25')
        ->and($mcp->initialize('2025-06-18')['protocolVersion'])->toBe('2025-06-18');

    // a request after the handshake, with the negotiated version as its header
    $mcp->rpc('ping')->assertOk()->assertJsonPath('result.resultType', 'complete');
});

it('refuses a call whose Mcp-Name does not match its body', function () use ($token) {
    $mcp = McpClient::for($this, $token());

    $mcp->rpc('tools/call', ['name' => 'whoami', 'arguments' => (object) []], ['Mcp-Name' => 'search'])
        ->assertStatus(400)
        ->assertJsonPath('error.code', -32020);
    // the same call with the right header reaches the tool
    $mcp->rpc('tools/call', ['name' => 'whoami', 'arguments' => (object) []])
        ->assertOk()
        ->assertJsonPath('result.isError', false);
});

it('refuses a request without a token', function () use ($problem) {
    $response = $this->postJson('/mcp', ['jsonrpc' => '2.0', 'id' => 1, 'method' => 'ping'], ['Accept' => 'application/json, text/event-stream']);

    $problem($response, 401, 'unauthenticated');
    expect($response->headers->get('WWW-Authenticate'))->toContain('realm="mcp"');
});

it('answers a real session cookie with 401', function () use ($problem) {
    config(['session.driver' => 'database']);
    User::factory()->create(['email' => 'lene@example.com', 'password' => 'lene-password']);

    $login = $this->post('/login', ['email' => 'lene@example.com', 'password' => 'lene-password'])->assertRedirect();
    $session = (string) $login->getCookie(config('session.cookie'))?->getValue();
    expect($session)->not->toBe('');
    // the next request comes in a fresh process: no guard and no session store keep the account of the sign-in
    forgetApiAuth();
    app()->forgetInstance('session.store');
    app('session')->forgetDrivers();

    // without the group web, neither EncryptCookies nor StartSession runs: the cookie signs nobody in
    $response = $this->withCookie(config('session.cookie'), $session)->withHeader('Referer', config('app.url'))
        ->postJson('/mcp', ['jsonrpc' => '2.0', 'id' => 1, 'method' => 'ping'], ['Accept' => 'application/json, text/event-stream']);

    $problem($response, 401, 'unauthenticated');
});

it('refuses a guard that knows the person without a token', function () use ($problem) {
    // defence in depth: Sanctum hands a person the web guard knows a TransientToken, whose can() says yes to everything
    $this->actingAs(User::factory()->create(), 'web');

    $response = $this->postJson('/mcp', ['jsonrpc' => '2.0', 'id' => 1, 'method' => 'ping'], ['Accept' => 'application/json, text/event-stream']);

    $problem($response, 403, 'token_required')
        ->assertJsonPath('detail', 'MCP takes a personal access token with the ability mcp.');
});

it('refuses a token without mcp', function () use ($token, $problem) {
    $response = McpClient::for($this, $token(['read', 'write']))->rpc('ping');

    $problem($response, 403, 'forbidden')
        ->assertJsonPath('detail', 'This token does not have the mcp ability.');
});

it('refuses a deactivated account', function () use ($token, $problem) {
    $plain = $token(['read', 'mcp'], User::factory()->disabled()->create());

    $problem(McpClient::for($this, $plain)->rpc('ping'), 401, 'unauthenticated');
});

it('answers GET and DELETE with 405', function (string $method) use ($token, $problem) {
    $headers = ['Accept' => 'application/json, text/event-stream'];

    $this->json($method, '/mcp', [], [...$headers, 'Authorization' => 'Bearer '.$token()])
        ->assertStatus(405)->assertHeader('Allow', 'POST');

    forgetApiAuth();
    $problem($this->json($method, '/mcp', [], $headers), 401, 'unauthenticated');
})->with(['GET', 'DELETE']);

it('refuses a body that is not JSON', function () use ($token, $problem) {
    $body = json_encode(['jsonrpc' => '2.0', 'id' => 1, 'method' => 'ping', 'params' => ['_meta' => [
        'io.modelcontextprotocol/protocolVersion' => McpClient::VERSION,
        'io.modelcontextprotocol/clientCapabilities' => (object) [],
    ]]]);

    $response = $this->call('POST', '/mcp', [], [], [], [
        'CONTENT_TYPE' => 'text/plain',
        'HTTP_ACCEPT' => 'application/json, text/event-stream',
        'HTTP_AUTHORIZATION' => 'Bearer '.$token(),
        'HTTP_MCP_PROTOCOL_VERSION' => McpClient::VERSION,
        'HTTP_MCP_METHOD' => 'ping',
    ], (string) $body);

    $problem($response, 415, 'unsupported_media_type')
        ->assertJsonPath('title', 'Unsupported media type');
});

it('refuses a body over 8 MiB', function () use ($token, $problem) {
    $response = $this->call('POST', '/mcp', [], [], [], [
        'CONTENT_TYPE' => 'application/json',
        'HTTP_ACCEPT' => 'application/json, text/event-stream',
        'HTTP_AUTHORIZATION' => 'Bearer '.$token(),
    ], str_pad('{"jsonrpc":"2.0","id":1,"method":"ping"}', LimitJsonBody::MAX_BYTES + 1));

    $problem($response, 413, 'payload_too_large');
});

it('refuses a foreign Origin', function () use ($token, $problem) {
    $mcp = McpClient::for($this, $token());
    $url = parse_url((string) config('app.url'));
    $own = $url['scheme'].'://'.$url['host'].(isset($url['port']) ? ':'.$url['port'] : '');

    $problem($mcp->rpc('ping', [], ['Origin' => 'https://evil.example.com']), 403, 'forbidden')
        ->assertJsonPath('detail', 'Only werkbuch itself or a client without a browser may talk to MCP.');
    // the scheme and the port belong to the origin
    $problem($mcp->rpc('ping', [], ['Origin' => 'http://'.$url['host'].':8443']), 403, 'forbidden');

    $mcp->rpc('ping', [], ['Origin' => $own])->assertOk();
    $mcp->rpc('ping')->assertOk();
});

it('throttles per token and keeps the quotas apart', function () use ($problem) {
    config(['werkbuch.rate_limits.mcp' => 2]);
    $this->freezeTime();
    $user = User::factory()->create();
    [$first, $second] = [apiToken($user, ['read', 'mcp']), apiToken($user, ['read', 'mcp'])];

    // REST requests of the same token spend the quota of the API, not the one of MCP
    foreach (range(1, 3) as $ignored) {
        forgetApiAuth();
        $this->getJson('/api/v1/organization', ['Authorization' => 'Bearer '.$first])->assertOk();
    }

    McpClient::for($this, $first)->rpc('ping')->assertOk()->assertHeader('X-RateLimit-Limit', '2')->assertHeader('X-RateLimit-Remaining', '1');
    McpClient::for($this, $first)->rpc('ping')->assertOk()->assertHeader('X-RateLimit-Remaining', '0');
    $problem(McpClient::for($this, $first)->rpc('ping'), 429, 'too_many_requests')->assertHeader('Retry-After', '60');

    // another token of the same account has its own quota
    McpClient::for($this, $second)->rpc('ping')->assertOk()->assertHeader('X-RateLimit-Remaining', '1');

    // a wrong token counts per address and spends nothing of a valid one
    $problem(McpClient::for($this, 'nope')->rpc('ping'), 401, 'unauthenticated');
    $problem(McpClient::for($this, 'nope')->rpc('ping'), 401, 'unauthenticated');
    $problem(McpClient::for($this, 'nope')->rpc('ping'), 429, 'too_many_requests');
    McpClient::for($this, $second)->rpc('ping')->assertOk()->assertHeader('X-RateLimit-Remaining', '0');
});

it('throttles a request with a wrong Mcp-Method header', function () use ($token, $problem) {
    config(['werkbuch.rate_limits.mcp' => 2]);
    $this->freezeTime();
    $mcp = McpClient::for($this, $token());

    // the package refuses the header, but only after the throttle counted the request
    foreach (range(1, 2) as $ignored) {
        $mcp->rpc('ping', [], ['Mcp-Method' => 'tools/list'])->assertStatus(400)->assertJsonPath('error.code', -32020);
    }

    $problem($mcp->rpc('ping', [], ['Mcp-Method' => 'tools/list']), 429, 'too_many_requests');
});

it('answers in the language of the account', function () use ($token, $problem) {
    $plain = $token(['read', 'write'], User::factory()->create(['locale' => 'de']));

    $problem(McpClient::for($this, $plain)->rpc('ping'), 403, 'forbidden')
        ->assertJsonPath('title', 'Verboten')
        ->assertJsonPath('detail', 'Diesem Token fehlt das Recht „mcp“.');
});
