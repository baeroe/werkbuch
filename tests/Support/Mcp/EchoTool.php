<?php

namespace Tests\Support\Mcp;

use App\Actions\Projects\ListMembers;
use App\Actions\Users\ListUsers;
use App\Exceptions\Problem;
use App\Http\Resources\ProjectMemberResource;
use App\Http\Resources\UserResource;
use App\Mcp\Support\McpAction;
use App\Mcp\Support\McpArguments;
use App\Mcp\Support\McpResult;
use App\Mcp\Support\ReadTool;
use App\Models\Project;
use App\Support\Actor;
use App\Support\References;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\Exceptions\ThrottleRequestsException;
use Illuminate\Validation\ValidationException;
use Laravel\Mcp\Server\Tools\Annotations\IsOpenWorld;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;
use RuntimeException;

/**
 * A read tool of the test server: its actions give back what they got (the arguments, a query, a reference), throw what
 * the argument `kind` asks for, or read a list with or without a twin.
 */
#[IsReadOnly]
#[IsOpenWorld(false)]
final class EchoTool extends ReadTool
{
    protected string $name = 'echo';

    protected string $title = 'Echo';

    protected function actions(): array
    {
        $query = ['filter', 'sort', 'include', 'lean', 'per_page', 'limit'];

        return [
            new McpAction('echo', 'Gives the arguments back.', fn (Actor $actor, McpArguments $args): McpResult => McpResult::body([
                'all' => $args->all(),
                'input' => $args->input(),
                'only' => $args->only(['title', 'note']),
            ])),
            new McpAction(
                'query', 'Gives the query back.',
                fn (Actor $actor, McpArguments $args): McpResult => McpResult::body(['query' => $args->query($query)]),
                parameters: array_fill_keys($query, ['type' => 'string']),
                defaults: ['lean' => true],
            ),
            new McpAction('reference', 'Gives the reference back.', fn (Actor $actor, McpArguments $args): McpResult => McpResult::body(['item' => $args->reference('item')])),
            new McpAction('throw', 'Throws what kind says.', fn (Actor $actor, McpArguments $args): McpResult => throw match ($args->get('kind')) {
                'conflict' => Problem::conflict('transition_not_allowed', ['states' => []], 'Not from here.'),
                'invalid' => ValidationException::withMessages(['title' => ['The title is too long.', 'The title is odd.'], 'due_date' => 'No day.']),
                'missing' => (new ModelNotFoundException)->setModel(Project::class),
                'search' => Problem::unavailable('search_unavailable'),
                'throttle' => new ThrottleRequestsException('Too Many Attempts.', null, ['Retry-After' => 42]),
                default => new RuntimeException('secret'),
            }),
            new McpAction(
                'users', 'Lists the accounts.',
                fn (Actor $actor, McpArguments $args): McpResult => McpResult::list(ListUsers::run($actor, $args->query(['filter', 'per_page'])), UserResource::class),
                parameters: ['filter' => ['type' => 'object'], 'per_page' => ['type' => 'integer']],
                twin: 'GET users',
            ),
            new McpAction(
                'members', 'Lists the members of a project.',
                fn (Actor $actor, McpArguments $args): McpResult => McpResult::list(
                    ListMembers::run($actor, References::project($args->reference('project')), $args->query(['per_page'])),
                    ProjectMemberResource::class,
                ),
                parameters: ['project' => ['type' => 'string'], 'per_page' => ['type' => 'integer']],
                twin: 'GET projects/{project}/members',
            ),
            new McpAction('unlisted', 'Lists the accounts without a twin.', fn (Actor $actor, McpArguments $args): McpResult => McpResult::list(
                ListUsers::run($actor, $args->query(['per_page'])), UserResource::class,
            )),
            new McpAction('done', 'Answers what REST answers with 204.', fn (Actor $actor, McpArguments $args): McpResult => McpResult::done()),
        ];
    }
}
