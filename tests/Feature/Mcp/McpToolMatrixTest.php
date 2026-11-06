<?php

use App\Models\Event;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Support\Facades\DB;
use Tests\Feature\Access\MatrixWorld;
use Tests\Support\Mcp\McpClient;
use Tests\Support\Mcp\ToolRows;
use Tests\Support\Mcp\TwinServer;

/*
 * Every action of every MCP tool × every kind of token of an org admin with `mcp` (phase 13, task 3b; Review Focus
 * "Rechte an REST vorbei"): a tool the token may not use is unknown (-32602), one it may use answers without 401, 403,
 * 404 or a server error. A read tool writes nothing: neither a statement that writes nor an event (the frame checks the
 * ability of the tool, nothing else keeps an action of a read tool from calling an action that writes). The rows:
 * tools.php, and twins.php of the twin server.
 */

const MCP_MATRIX_TOKENS = ['mcp' => ['mcp'], 'read+mcp' => ['read', 'mcp'], 'write+mcp' => ['write', 'mcp'], 'read+write+mcp' => ['read', 'write', 'mcp']];

beforeEach(fn () => TwinServer::serve());

/**
 * Records the statements that write from now on (inserts, updates, deletes); Sanctum's `last_used_at` of the token is
 * no write of the action.
 */
$watchWrites = function (): ArrayObject {
    /** @var ArrayObject<int, string> $writes */
    $writes = new ArrayObject;
    DB::listen(function (QueryExecuted $query) use ($writes) {
        if (preg_match('/^\s*(insert|update|delete|replace)\b/i', $query->sql) === 1 && ! str_contains($query->sql, 'personal_access_tokens')) {
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
    $result = $response->json('result');
    if ($result['isError']) {
        expect($result['structuredContent']['status'])->not->toBeIn([401, 403, 404], $context)->toBeLessThan(500, $context);
    }
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

it('keeps the rows in sync with the tools', function (string $suite) {
    $rows = array_keys(ToolRows::rows($suite));
    sort($rows);
    $keys = ToolRows::keys($suite);
    sort($keys);

    expect($keys)->toContain($suite === 'werkbuch' ? 'whoami:call' : 'twins:query')
        ->and($rows)->toBe($keys);
})->with(array_keys(ToolRows::SUITES));
