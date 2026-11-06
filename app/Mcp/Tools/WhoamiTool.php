<?php

namespace App\Mcp\Tools;

use App\Actions\Users\GetMe;
use App\Http\Resources\MeResource;
use App\Mcp\Support\McpAction;
use App\Mcp\Support\McpArguments;
use App\Mcp\Support\McpResult;
use App\Mcp\Support\ReadTool;
use App\Support\Actor;
use Laravel\Mcp\Server\Tools\Annotations\IsOpenWorld;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

/**
 * `whoami`: the account of the token, as `GET /api/v1/me` answers it (A392), so an agent learns who it is, which bot or
 * person, and what its role in the organization allows.
 */
#[IsReadOnly]
#[IsOpenWorld(false)]
final class WhoamiTool extends ReadTool
{
    protected string $name = 'whoami';

    protected string $title = 'Who am I';

    protected string $description = 'The account of the token (person or bot), its language, time zone, role in the organization and the rights that role grants.';

    protected function actions(): array
    {
        return [new McpAction(
            name: 'call',
            summary: 'The account of the token.',
            run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new MeResource(GetMe::run($actor))),
            twin: 'GET me',
        )];
    }
}
