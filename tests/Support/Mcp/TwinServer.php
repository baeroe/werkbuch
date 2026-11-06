<?php

namespace Tests\Support\Mcp;

use App\Mcp\Servers\WerkbuchServer;
use Laravel\Mcp\Server;

/**
 * An MCP server whose tools mirror a few REST operations like the real ones will (a list with filters, a list of a
 * project, two read bodies, two write bodies and a delete), served at `mcp/_twins` behind the door of /mcp. The harness
 * of task 3b (matrix, schemas, parity, the ability of the twin) runs over its rows (`twins.php`) as over `tools.php`,
 * so every branch of it runs before the areas bring their tools, and a broken harness shows.
 */
final class TwinServer extends Server
{
    public const PATH = 'mcp/_twins';

    protected string $name = 'werkbuch-twins';

    protected string $version = '1';

    protected array $tools = [TwinTool::class, ManageTwinTool::class];

    public static function serve(): void
    {
        WerkbuchServer::serve(self::PATH, self::class);
    }
}
