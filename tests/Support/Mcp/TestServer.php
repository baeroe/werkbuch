<?php

namespace Tests\Support\Mcp;

use App\Mcp\Servers\WerkbuchServer;
use Laravel\Mcp\Server;

/**
 * An MCP server for the tests of the tool frame, served at `mcp/_t` behind the same door as /mcp (so the arguments get
 * the same cleaning and refusals come as problems, `ApiPaths` takes `mcp/*`). Call `TestServer::serve()` in a test.
 */
final class TestServer extends Server
{
    public const PATH = 'mcp/_t';

    protected string $name = 'werkbuch-test';

    protected string $version = '1';

    protected array $tools = [EchoTool::class, EchoWriteTool::class];

    public static function serve(): void
    {
        WerkbuchServer::serve(self::PATH, self::class);
    }
}
