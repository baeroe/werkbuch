<?php

use App\Access\ProjectRole;
use App\Mcp\Support\McpAction;
use App\Mcp\Support\McpArguments;
use App\Mcp\Support\McpResult;
use App\Models\Project;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Arr;
use Tests\Support\Mcp\McpClient;
use Tests\Support\Mcp\TestServer;
use Tests\TestCase;

/*
 * The arguments of a tool call (phase 13, task 3a; A149, K6, K7, K8): read from the JSON body after TrimStrings and
 * ConvertEmptyStringsToNull like REST, handed to a GET twin in the shape of its query, with the defaults of the action.
 */

beforeEach(fn () => TestServer::serve());

/** A client of the test server with a token of a new account (or of the given one) with read and mcp. */
$echo = fn (TestCase $t, ?User $user = null): McpClient => McpClient::for($t, apiToken($user ?? User::factory()->create(), ['read', 'mcp']), path: '/'.TestServer::PATH);

/** The arguments of a request whose body carries them. */
$arguments = fn (array $arguments): McpArguments => McpArguments::from(Request::create('/mcp', 'POST', server: ['CONTENT_TYPE' => 'application/json'], content: (string) json_encode(['params' => ['arguments' => $arguments]])));

$noop = fn (): McpResult => McpResult::done();

it('trims unicode whitespace like REST', function () use ($echo) {
    $result = $echo($this)->call('echo', ['action' => 'echo', 'title' => "\u{00A0}", 'note' => " \u{2003}Notiz\u{00A0} "]);

    expect($result['structuredContent']['only'])->toBe(['title' => null, 'note' => 'Notiz']);
});

it('keeps the spaces of rich text nodes', function () use ($echo) {
    $doc = ['type' => 'doc', 'content' => [['type' => 'paragraph', 'content' => [
        ['type' => 'text', 'text' => 'a', 'marks' => [['type' => 'bold']]],
        ['type' => 'text', 'text' => ' '],
        ['type' => 'text', 'text' => 'b', 'marks' => [['type' => 'italic']]],
    ]]]];

    $input = $echo($this)->call('echo', ['action' => 'echo', 'input' => ['title' => ' Titel ', 'description_json' => $doc]])['structuredContent']['input'];

    // the text node between the marks stays, the title next to it is trimmed
    expect($input['description_json'])->toBe($doc)
        ->and($input['title'])->toBe('Titel');
});

it('turns an empty string into null', function () use ($echo) {
    $result = $echo($this)->call('echo', ['action' => 'echo', 'note' => '', 'input' => ['title' => '']]);

    expect($result['structuredContent']['only'])->toBe(['note' => null])
        ->and($result['structuredContent']['input'])->toBe(['title' => null]);
});

it('gives an empty input without one', function () use ($echo) {
    $mcp = $echo($this);

    expect($mcp->call('echo', ['action' => 'echo'])['structuredContent']['input'])->toBe([])
        ->and($mcp->call('echo', ['action' => 'echo', 'input' => 'text'])['structuredContent']['input'])->toBe([])
        ->and($mcp->call('echo', ['action' => 'echo', 'title' => 'x'])['structuredContent']['all'])->toBe(['action' => 'echo', 'title' => 'x']);
});

it('refuses an unknown action with the allowed ones', function (array $arguments) use ($echo) {
    $result = $echo($this)->call('echo', $arguments);
    $allowed = 'echo, query, reference, throw, users, members, unlisted, done';

    expect($result['isError'])->toBeTrue()
        ->and($result['structuredContent']['status'])->toBe(422)
        ->and($result['structuredContent']['errors'])->toBe(['action' => ["There is no such action. Actions: {$allowed}."]])
        ->and($result['content'][0]['text'])->toEndWith("\naction: There is no such action. Actions: {$allowed}.");
})->with([
    'unknown' => [['action' => 'nope']],
    'missing' => [[]],
    'no text' => [['action' => ['echo']]],
]);

it('refuses a reference that is no text', function () use ($echo) {
    $mcp = $echo($this);

    expect($mcp->call('echo', ['action' => 'reference', 'item' => 'WEB-1'])['structuredContent'])->toBe(['item' => 'WEB-1']);

    $result = $mcp->call('echo', ['action' => 'reference', 'item' => 47]);
    expect($result['isError'])->toBeTrue()
        ->and($result['structuredContent']['errors'])->toBe(['item' => ['This field is missing.']]);
});

it('turns a list filter into the comma form of the query', function () use ($echo) {
    $result = $echo($this)->call('echo', ['action' => 'query',
        'filter' => ['type' => ['person', 'bot'], 'disabled' => false, 'owner_id' => null, 'label' => [], 'nested' => ['a' => 1]],
        'include' => ['children', 'relations'],
        'sort' => null,
        'lean' => true,
        'per_page' => 10,
        'limit' => 2.5,
    ]);

    // a nested object stays an object, which the action refuses; null and an empty list stay out
    expect($result['structuredContent']['query'])->toBe([
        'filter' => ['type' => 'person,bot', 'disabled' => '0', 'nested' => ['a' => 1]],
        'include' => 'children,relations',
        'lean' => '1',
        'per_page' => '10',
        'limit' => '2.5',
    ]);
});

it('refuses an object in a filter like REST, never searching its JSON', function () use ($echo) {
    $mcp = $echo($this, User::factory()->admin()->create());

    $object = $mcp->call('echo', ['action' => 'users', 'filter' => ['type' => ['kind' => 'person']]]);
    $list = $mcp->call('echo', ['action' => 'users', 'filter' => ['type' => [['kind' => 'person']]]]);

    foreach ([$object, $list] as $result) {
        expect($result['isError'])->toBeTrue()
            ->and($result['structuredContent']['status'])->toBe(422)
            ->and(array_keys($result['structuredContent']['errors']))->toBe(['filter.type']);
    }
});

it('hands a list filter to the action like REST', function () use ($echo) {
    User::factory()->bot()->create();

    $result = $echo($this, User::factory()->admin()->create())->call('echo', ['action' => 'users', 'filter' => ['type' => ['person', 'bot']]]);

    expect($result['isError'])->toBeFalse()
        ->and($result['structuredContent']['meta']['total'])->toBe(User::query()->count());
});

it('applies the defaults of an action', function () use ($echo, $arguments, $noop) {
    $mcp = $echo($this);

    expect($mcp->call('echo', ['action' => 'query'])['structuredContent']['query'])->toBe(['lean' => '1', 'per_page' => '25'])
        ->and($mcp->call('echo', ['action' => 'query', 'lean' => null])['structuredContent']['query'])->toBe(['lean' => '1', 'per_page' => '25'])
        ->and($mcp->call('echo', ['action' => 'query', 'lean' => false, 'per_page' => 5])['structuredContent']['query'])->toBe(['lean' => '0', 'per_page' => '5']);

    // per_page only for an action that has it, and an action may name another
    $plain = new McpAction('plain', 'x', $noop);
    $paged = new McpAction('paged', 'x', $noop, parameters: ['per_page' => ['type' => 'integer']]);
    $own = new McpAction('own', 'x', $noop, parameters: ['per_page' => ['type' => 'integer']], defaults: ['per_page' => 50]);

    expect($arguments(['x' => 1])->withDefaults($plain)->all())->toBe(['x' => 1])
        ->and($arguments([])->withDefaults($paged)->all())->toBe(['per_page' => McpAction::PER_PAGE])
        ->and($arguments([])->withDefaults($own)->all())->toBe(['per_page' => 50]);
});

it('reads no arguments from a body without them', function () {
    $request = Request::create('/mcp', 'POST', server: ['CONTENT_TYPE' => 'application/json'], content: '{"params": {"arguments": "text"}}');

    expect(McpArguments::from($request)->all())->toBe([])
        ->and(McpArguments::from(Request::create('/mcp', 'POST'))->action())->toBeNull();
});

it('fills the path of the twin from the arguments', function () use ($arguments, $noop) {
    $action = new McpAction('version', 'x', $noop, twin: 'GET pages/{page}/versions/{pageVersion}', path: ['page' => 'id']);

    expect($action->twinPath($arguments(['id' => '01JX', 'page_version' => 'a b'])))->toBe(url('api/v1/pages/01JX/versions/a%20b'))
        ->and((new McpAction('none', 'x', $noop))->twinPath($arguments([])))->toBeNull();
});

it('sets the path of a list to the one of its twin', function () {
    $admin = User::factory()->admin()->create();
    $project = Project::factory()->member($admin, ProjectRole::Admin)->create();
    $plain = apiToken($admin, ['read', 'mcp']);
    $mcp = McpClient::for($this, $plain, path: '/'.TestServer::PATH);
    $rest = function (string $uri) use ($plain): array {
        forgetApiAuth();

        return $this->getJson($uri, ['Authorization' => 'Bearer '.$plain])->assertOk()->json();
    };

    $users = $mcp->call('echo', ['action' => 'users', 'per_page' => 100])['structuredContent'];
    $members = $mcp->call('echo', ['action' => 'members', 'project' => $project->identifier, 'per_page' => 100])['structuredContent'];

    // the body of the twin without links; MCP reads 25 a page unless it says otherwise
    expect($users)->toBe(Arr::except($rest('/api/v1/users'), 'links'))
        ->and($members)->toBe(Arr::except($rest("/api/v1/projects/{$project->identifier}/members"), 'links'))
        ->and($members['meta']['path'])->toBe(url("api/v1/projects/{$project->identifier}/members"))
        ->and($mcp->call('echo', ['action' => 'users'])['structuredContent']['meta']['per_page'])->toBe(25);

    // without a twin there is no path
    $unlisted = $mcp->call('echo', ['action' => 'unlisted'])['structuredContent'];
    expect($unlisted['meta'])->toHaveKey('total')
        ->and(array_keys($unlisted['meta']))->not->toContain('path');
});
