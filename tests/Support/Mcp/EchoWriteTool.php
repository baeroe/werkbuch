<?php

namespace Tests\Support\Mcp;

use App\Mcp\Support\McpAction;
use App\Mcp\Support\McpArguments;
use App\Mcp\Support\McpResult;
use App\Mcp\Support\WriteTool;
use App\Support\Actor;
use Laravel\Mcp\Server\Tools\Annotations\IsDestructive;
use Laravel\Mcp\Server\Tools\Annotations\IsOpenWorld;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

/**
 * A write tool of the test server with a single action (no argument `action`).
 */
#[IsDestructive]
#[IsReadOnly(false)]
#[IsOpenWorld(false)]
final class EchoWriteTool extends WriteTool
{
    protected string $name = 'manage-echo';

    protected string $title = 'Manage echo';

    protected function actions(): array
    {
        return [new McpAction('call', 'Answers that it wrote.', fn (Actor $actor, McpArguments $args): McpResult => McpResult::body(['written' => $actor->via]))];
    }
}
