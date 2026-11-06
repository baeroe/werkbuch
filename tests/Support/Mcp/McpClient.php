<?php

namespace Tests\Support\Mcp;

use Illuminate\Testing\TestResponse;
use Laravel\Mcp\Transport\HeaderValue;
use PHPUnit\Framework\Assert;
use Tests\TestCase;

/**
 * A client of /mcp for tests, speaking JSON-RPC over the route with a bearer token. Two modes (K3):
 *
 * - `current` (`2026-07-28`): `server/discover`, every request carries `params._meta` with the protocol version and the
 *   capabilities of the client, and the headers `MCP-Protocol-Version`, `Mcp-Method` and `Mcp-Name` (the tool of a
 *   `tools/call`, the URI of a `resources/read`), as the package's ValidateMcpHeaders asks;
 * - `legacy`: the handshake `initialize`, then `notifications/initialized`; later requests carry the negotiated
 *   version in `MCP-Protocol-Version`.
 *
 * Every request starts without the account of the last (Sanctum's guard keeps it within a test).
 */
final class McpClient
{
    public const CURRENT = 'current';

    public const LEGACY = 'legacy';

    public const VERSION = '2026-07-28';

    private int $id = 0;

    private ?string $negotiated = null;

    private function __construct(private readonly TestCase $test, private readonly string $token, private readonly string $mode, private readonly string $path) {}

    /** A client of the server at `$path`: /mcp, or the test server at `TestServer::PATH`. */
    public static function for(TestCase $t, string $token, string $mode = self::CURRENT, string $path = '/mcp'): self
    {
        return new self($t, $token, $mode, $path);
    }

    /**
     * `server/discover` of the current protocol: the result, its server named werkbuch.
     *
     * @return array<string, mixed>
     */
    public function discover(): array
    {
        $result = $this->result($this->rpc('server/discover'));
        Assert::assertSame('werkbuch', $result['_meta']['io.modelcontextprotocol/serverInfo']['name'] ?? null);

        return $result;
    }

    /**
     * The handshake of the legacy protocol: `initialize`, then `notifications/initialized` (202 without a body).
     *
     * @return array<string, mixed>
     */
    public function initialize(string $version = '2025-11-25'): array
    {
        $result = $this->result($this->rpc('initialize', [
            'protocolVersion' => $version,
            'capabilities' => (object) [],
            'clientInfo' => ['name' => 'werkbuch-tests', 'version' => '1.0'],
        ]));
        Assert::assertSame('werkbuch', $result['serverInfo']['name'] ?? null);
        $this->negotiated = $result['protocolVersion'];

        $this->notify('notifications/initialized')->assertStatus(202)->assertContent('');

        return $result;
    }

    /**
     * All tools, page after page.
     *
     * @return list<array<string, mixed>>
     */
    public function tools(): array
    {
        return $this->all('tools/list', 'tools');
    }

    /**
     * Calls a tool: its result, `isError` included.
     *
     * @param  array<string, mixed>  $arguments
     * @return array<string, mixed>
     */
    public function call(string $tool, array $arguments = []): array
    {
        return $this->result($this->rpc('tools/call', ['name' => $tool, 'arguments' => (object) $arguments]));
    }

    /**
     * All resources, page after page.
     *
     * @return list<array<string, mixed>>
     */
    public function resources(): array
    {
        return $this->all('resources/list', 'resources');
    }

    /** @return array<string, mixed> */
    public function read(string $uri): array
    {
        return $this->result($this->rpc('resources/read', ['uri' => $uri]));
    }

    /**
     * A request as it is sent, its answer raw; `$headers` replace those of the mode (a wrong `Mcp-Method`, an `Origin`).
     *
     * @param  array<string, mixed>  $params
     * @param  array<string, string>  $headers
     */
    public function rpc(string $method, array $params = [], array $headers = []): TestResponse
    {
        return $this->send(['jsonrpc' => '2.0', 'id' => ++$this->id, 'method' => $method, 'params' => $this->params($params)], $method, $params, $headers);
    }

    /**
     * A notification (no `id`): the server answers 202 without a body.
     *
     * @param  array<string, mixed>  $params
     */
    public function notify(string $method, array $params = []): TestResponse
    {
        return $this->send(['jsonrpc' => '2.0', 'method' => $method, 'params' => $this->params($params)], $method, $params, []);
    }

    /**
     * @param  array<string, mixed>  $body
     * @param  array<string, mixed>  $params
     * @param  array<string, string>  $headers
     */
    private function send(array $body, string $method, array $params, array $headers): TestResponse
    {
        app('auth')->forgetGuards();

        return $this->test->postJson($this->path, $body, [
            'Authorization' => 'Bearer '.$this->token,
            'Accept' => 'application/json, text/event-stream',
            ...$this->headers($method, $params),
            ...$headers,
        ]);
    }

    /**
     * @param  array<string, mixed>  $params
     * @return array<string, mixed>
     */
    private function params(array $params): array
    {
        if ($this->mode !== self::CURRENT) {
            return $params;
        }

        return [...$params, '_meta' => [
            'io.modelcontextprotocol/protocolVersion' => self::VERSION,
            'io.modelcontextprotocol/clientCapabilities' => (object) [],
        ]];
    }

    /**
     * @param  array<string, mixed>  $params
     * @return array<string, string>
     */
    private function headers(string $method, array $params): array
    {
        if ($this->mode !== self::CURRENT) {
            return $this->negotiated === null ? [] : ['MCP-Protocol-Version' => $this->negotiated];
        }

        $name = match ($method) {
            'tools/call' => $params['name'] ?? null,
            'resources/read' => $params['uri'] ?? null,
            default => null,
        };

        return [
            'MCP-Protocol-Version' => self::VERSION,
            'Mcp-Method' => $method,
            ...is_string($name) ? ['Mcp-Name' => (string) new HeaderValue($name)] : [],
        ];
    }

    /** @return array<string, mixed> */
    private function result(TestResponse $response): array
    {
        $response->assertOk();
        $result = $response->json('result');
        Assert::assertIsArray($result, 'No result: '.$response->getContent());

        return $result;
    }

    /** @return list<array<string, mixed>> */
    private function all(string $method, string $key): array
    {
        $found = [];
        $cursor = null;

        do {
            $result = $this->result($this->rpc($method, $cursor === null ? [] : ['cursor' => $cursor]));
            $found = [...$found, ...$result[$key]];
            $cursor = $result['nextCursor'] ?? null;
        } while (is_string($cursor));

        return $found;
    }
}
