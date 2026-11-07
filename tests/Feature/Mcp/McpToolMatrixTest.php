<?php

use App\Models\Event;
use App\Models\PersonalAccessToken;
use App\Models\User;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Feature\Access\MatrixWorld;
use Tests\Support\Mcp\McpClient;
use Tests\Support\Mcp\ToolRows;
use Tests\Support\Mcp\TwinServer;

/*
 * Every action of every MCP tool × every kind of token of an org admin with `mcp` (phase 13, task 3b; Review Focus
 * "Rechte an REST vorbei"): a tool the token may not use is unknown (-32602), one it may use succeeds, or answers
 * exactly the refusal its row names (`'refuses'`). A read tool writes nothing: neither a statement that writes nor an event (the frame checks the
 * ability of the tool, nothing else keeps an action of a read tool from calling an action that writes). The rows:
 * tools.php, and twins.php of the twin server.
 */

const MCP_MATRIX_TOKENS = ['mcp' => ['mcp'], 'read+mcp' => ['read', 'mcp'], 'write+mcp' => ['write', 'mcp'], 'read+write+mcp' => ['read', 'write', 'mcp']];

beforeEach(fn () => TwinServer::serve());

/**
 * Records the statements that write from now on (inserts, updates, deletes); only Sanctum's update of `last_used_at` of
 * the token is no write of the action (a token deleted or created is).
 */
$watchWrites = function (): ArrayObject {
    /** @var ArrayObject<int, string> $writes */
    $writes = new ArrayObject;
    DB::listen(function (QueryExecuted $query) use ($writes) {
        if (preg_match('/^\s*(insert|update|delete|replace)\b/i', $query->sql) === 1 && preg_match('/^update `personal_access_tokens` set `last_used_at` = \?/', $query->sql) !== 1) {
            $writes[] = $query->sql;
        }
    });

    return $writes;
};

it('opens each action only to tokens with the right ability', function (string $suite, string $key, string $token) use ($watchWrites) {
    $w = MatrixWorld::build();
    [$tool] = ToolRows::action($suite, $key);
    $arguments = ToolRows::arguments($suite, $key, $w);
    $mcp = McpClient::for($this, apiToken($w->account('org_admin'), MCP_MATRIX_TOKENS[$token]), path: ToolRows::path($suite));
    $events = Event::query()->count();
    $writes = $watchWrites();

    $response = $mcp->rpc('tools/call', ['name' => $tool->name(), 'arguments' => (object) $arguments]);
    $context = "{$key} with {$token}: {$response->getContent()}";

    if (! in_array($tool->ability(), MCP_MATRIX_TOKENS[$token], true)) {
        $response->assertStatus(400)->assertJsonPath('error.code', -32602);

        return;
    }

    $response->assertOk();
    // a success, or exactly the refusal the row names; never a 401, 403, 404, 409 or 422 the row did not ask for
    ToolRows::expectOutcome(json_decode((string) $response->getContent())->result, ToolRows::refusal($suite, $key), $context);
    if ($tool->ability() === 'read') {
        expect($writes->getArrayCopy())->toBe([], $context)
            ->and(Event::query()->count())->toBe($events, $context);
    }
})->with(ToolRows::dataset())->with(array_keys(MCP_MATRIX_TOKENS));

it('sees what a write tool writes', function () use ($watchWrites) {
    $w = MatrixWorld::build();
    $arguments = ToolRows::arguments('twins', 'manage-twins:create-view', $w);
    $mcp = McpClient::for($this, apiToken($w->account('org_admin'), ['write', 'mcp']), path: ToolRows::path('twins'));
    $events = Event::query()->count();
    $writes = $watchWrites();

    expect($mcp->call('manage-twins', $arguments)['isError'])->toBeFalse()
        ->and(preg_grep('/^insert into `views`/', $writes->getArrayCopy()))->toHaveCount(1)
        ->and(Event::query()->count())->toBe($events + 1);
});

it('counts every write on tokens but the use of the token', function () use ($watchWrites) {
    $user = User::factory()->create();
    $token = PersonalAccessToken::query()->findOrFail(Str::before(apiToken($user, ['read']), '|'));
    $writes = $watchWrites();

    // what Sanctum writes when a token is used is no write of the action
    $token->forceFill(['last_used_at' => now()])->save();
    expect($writes->getArrayCopy())->toBe([]);

    // a token deleted (or any other write on the table) is
    $token->delete();
    expect(preg_grep('/^delete from `personal_access_tokens`/', $writes->getArrayCopy()))->toHaveCount(1);
});

it('keeps the rows in sync with the tools', function (string $suite) {
    $rows = array_keys(ToolRows::rows($suite));
    sort($rows);
    $keys = ToolRows::keys($suite);
    sort($keys);

    expect($keys)->toContain($suite === 'werkbuch' ? 'whoami:call' : 'twins:query')
        ->and($rows)->toBe($keys);
})->with(array_keys(ToolRows::SUITES));
