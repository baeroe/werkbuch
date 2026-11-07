<?php

use App\Mcp\Servers\WerkbuchServer;
use App\Mcp\Support\McpAction;
use App\Mcp\Support\WerkbuchTool;
use Illuminate\Routing\Route as RouteDefinition;
use Illuminate\Support\Facades\Route;

/*
 * The MCP guide (docs/{en,de}/mcp.md, phase 13, task 13) tells what the server does: its table of tools names exactly
 * the tools of WerkbuchServer, in their order, with every action, its required arguments and its REST twin; the
 * guides of MCP, bots and webhooks name only tools and actions that exist.
 */

/**
 * The tools of the server, in the order `tools/list` gives them.
 *
 * @return array<string, WerkbuchTool>
 */
$tools = function (): array {
    $tools = [];
    foreach ((new ReflectionClass(WerkbuchServer::class))->getDefaultProperties()['tools'] as $class) {
        /** @var WerkbuchTool $tool */
        $tool = app($class);
        $tools[$tool->name()] = $tool;
    }

    return $tools;
};

/**
 * The table of tools of a guide, between `<!-- tools:start -->` and `<!-- tools:end -->`: a heading `` ### `tool` `` per
 * tool, then rows `` | `action` | purpose | `required`, … or – | `METHOD /uri` or – | ``.
 *
 * @return array<string, array<string, array{required: list<string>, twin: string|null}>>
 */
$table = function (string $language): array {
    $page = (string) file_get_contents(repo_path("docs/{$language}/mcp.md"));
    expect(preg_match('/<!-- tools:start -->(.*)<!-- tools:end -->/s', $page, $section))->toBe(1, "{$language}: the table of tools");

    $names = fn (string $cell): array => preg_match_all('/`([^`]+)`/', $cell, $m) ? $m[1] : [];
    $tools = [];
    $tool = null;
    foreach (explode("\n", $section[1]) as $line) {
        if (preg_match('/^### `([^`]+)`$/', $line, $heading)) {
            $tool = $heading[1];
            $tools[$tool] = [];

            continue;
        }
        if (! preg_match('/^\| `([^`]+)` \|/', $line, $action)) {
            continue;
        }
        expect($tool)->toBeString("{$language}: a row before the first tool: {$line}");
        $cells = array_map('trim', explode('|', trim($line, ' |')));
        expect($cells)->toHaveCount(4, "{$language}: {$line}");
        $twin = $names($cells[3]);
        $tools[$tool][$action[1]] = ['required' => $names($cells[2]), 'twin' => $twin === [] ? null : $twin[0]];
    }

    return $tools;
};

it('names every tool and action in the docs', function () use ($tools, $table) {
    $server = $tools();
    expect($server)->toHaveCount(29)->toHaveKey('manage-work-items');

    foreach (['en', 'de'] as $language) {
        $rows = $table($language);
        expect(array_keys($rows))->toBe(array_keys($server), "{$language}: the tools of the table");

        foreach ($server as $name => $tool) {
            expect(array_keys($rows[$name]))->toBe($tool->actionNames(), "{$language}: the actions of {$name}");
            foreach ($tool->actionNames() as $action) {
                $code = $tool->actionNamed($action);
                assert($code instanceof McpAction);
                expect($rows[$name][$action])->toBe([
                    'required' => $code->required,
                    // the twin as the guide writes it: the path below /api/v1
                    'twin' => $code->twin === null ? null : preg_replace('/^(\w+) /', '$1 /', $code->twin),
                ], "{$language}: {$name}:{$action}");
            }
        }
    }
});

it('names only existing tools', function () use ($tools) {
    $server = $tools();
    $named = 0;

    foreach (['mcp', 'bots', 'webhooks'] as $page) {
        foreach (['en', 'de'] as $language) {
            $text = (string) file_get_contents(repo_path("docs/{$language}/{$page}.md"));
            preg_match_all('/`([^`\n]+)`/', $text, $code);
            // a heading of nothing but code names a tool on the MCP page (the webhooks page has `data` per event)
            preg_match_all('/^### `([^`]+)`$/m', $page === 'mcp' ? $text : '', $headings);

            foreach ($headings[1] as $heading) {
                expect($server)->toHaveKey($heading, message: "{$language}/{$page}: the heading {$heading}");
                $named++;
            }
            foreach ($code[1] as $snippet) {
                if (preg_match('/^manage-[a-z-]+$/', $snippet)) {
                    expect($server)->toHaveKey($snippet, message: "{$language}/{$page}: {$snippet}");
                    $named++;
                }
                if (preg_match('/^([a-z][a-z-]*):([a-z][a-z-]*)$/', $snippet, $pair) && (isset($server[$pair[1]]) || str_starts_with($pair[1], 'manage-'))) {
                    expect($server)->toHaveKey($pair[1], message: "{$language}/{$page}: {$snippet}");
                    expect($server[$pair[1]]->actionNamed($pair[2]))->toBeInstanceOf(McpAction::class, "{$language}/{$page}: {$snippet}");
                    $named++;
                }
            }
        }
    }

    // the pages name tools at all: the agent of bots and webhooks works over MCP
    expect($named)->toBeGreaterThan(29 * 2);
    foreach (['en', 'de'] as $language) {
        foreach (['bots', 'webhooks'] as $page) {
            expect((string) file_get_contents(repo_path("docs/{$language}/{$page}.md")))
                ->toContain('`manage-comments:add`', '`manage-work-items:transition`', "/{$language}/mcp");
        }
    }
});

it('shows a REST twin that exists', function () use ($table) {
    $routes = [];
    foreach (Route::getRoutes()->getRoutes() as $route) {
        /** @var RouteDefinition $route */
        foreach ($route->methods() as $method) {
            $routes["{$method} /{$route->uri()}"] = true;
        }
    }

    foreach (['en', 'de'] as $language) {
        $twins = array_values(array_filter(array_merge(...array_map(fn (array $actions) => array_column($actions, 'twin'), array_values($table($language))))));
        expect(count($twins))->toBeGreaterThan(100, "{$language}: the twins of the table");

        foreach ($twins as $twin) {
            [$method, $path] = explode(' ', $twin, 2);
            expect($routes)->toHaveKey("{$method} /api/v1{$path}", message: "{$language}: {$twin}");
        }
    }
});
