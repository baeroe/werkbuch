<?php

use Illuminate\Routing\Route as RouteDefinition;
use Illuminate\Support\Facades\Route;
use Tests\Support\UiApiCalls;

/*
 * "API und MCP hinken nicht hinterher" from the other side: whatever the interface asks the server through
 * resources/js/api goes to a route of /api/v1 with that method (spec 6.1, Task 7). The only web path it posts to is
 * the batch of the live channels; `/sanctum/csrf-cookie` (http.ts) and the file route `/attachments/…`
 * (`attachmentUrl`) are no calls of a request function.
 */

/** The web paths the interface may post to: they are no routes of the API. */
const UI_WEB_CALLS = ['POST /broadcasting/batch'];

/** The methods and URIs of the routes below api/v1, without the routes tests register under api/v1/_t. */
$apiRoutes = function (): array {
    $routes = [];

    foreach (Route::getRoutes()->getRoutes() as $route) {
        /** @var RouteDefinition $route */
        if (str_starts_with($route->uri(), 'api/v1/') && ! str_starts_with($route->uri(), 'api/v1/_t/')) {
            foreach ($route->methods() as $method) {
                $routes[] = ['method' => $method, 'uri' => '/'.$route->uri()];
            }
        }
    }

    return $routes;
};

/** The TypeScript of resources/js/api without its tests. */
$sources = function (): array {
    $sources = [];

    foreach (glob(base_path('resources/js/api/*.ts')) ?: [] as $file) {
        if (! str_ends_with($file, '.test.ts')) {
            $sources[basename($file)] = (string) file_get_contents($file);
        }
    }

    return $sources;
};

it('reads every call of resources/js/api', function () use ($sources) {
    ['calls' => $calls, 'unresolved' => $unresolved] = UiApiCalls::of($sources());

    expect($unresolved)->toBe([])
        // a sanity bound: the interface makes well over a hundred kinds of calls
        ->and(count($calls))->toBeGreaterThan(100)
        ->and(collect($calls)->pluck('file')->unique()->count())->toBeGreaterThan(20);
});

it('sends every call of the interface to a route of /api/v1 with its method', function () use ($sources, $apiRoutes) {
    ['calls' => $calls] = UiApiCalls::of($sources());
    [$web, $api] = collect($calls)->partition(fn (array $call) => $call['web']);

    expect(UiApiCalls::unmatched($api->values()->all(), $apiRoutes()))->toBe([])
        ->and($web->map(fn (array $call) => "{$call['method']} {$call['path']}")->unique()->values()->all())->toBe(UI_WEB_CALLS);
});

it('follows aliases, helpers, constants, choices and wrappers the way the api files write them', function () {
    $sources = [
        'paths.ts' => "export const projectPath = (id: string) => `/projects/\${encodeURIComponent(id)}`;\n",
        'things.ts' => <<<'TS'
            import { del, get as fetchOne, getPage, patch as sendPatch, post, saveOne, webPost } from './http';
            import { projectPath } from './paths';

            const thingPath = (id: string) => `${projectPath(id)}/things`;

            async function mark(path: string, ids: readonly string[]): Promise<{ updated: number }> {
              return post<{ updated: number }>(path, { ids });
            }

            export function one(id: string) {
              return fetchOne<{ data: { run: Run; item: Item | null } }>(thingPath(id), { include: 'a' });
            }
            export function all() {
              return getPage<Thing>('/things?sort=name', {});
            }
            export function change(id: string, archived: boolean) {
              const path = `${thingPath(id)}/${archived ? 'archive' : 'restore'}`;
              return sendPatch<void>(path, {});
            }
            export function remove(id: string, emoji: string) {
              return del<void>(`/things/${id}?emoji=${encodeURIComponent(emoji)}`);
            }
            export const save = (id?: string) => saveOne<Thing>('/things', id, {});
            export const read = () => mark('/things/read', []);
            export const live = () => webPost('/broadcasting/batch', {});
            export const odd = (where: string) => post(where.toLowerCase(), {});
            TS,
    ];

    ['calls' => $calls, 'unresolved' => $unresolved] = UiApiCalls::of($sources);

    expect(array_map(fn (array $call) => "{$call['method']} {$call['path']}", $calls))->toEqualCanonicalizing([
        'DELETE /api/v1/things/{}',
        'GET /api/v1/projects/{}/things',
        'GET /api/v1/things',
        'PATCH /api/v1/projects/{}/things/archive',
        'PATCH /api/v1/projects/{}/things/restore',
        'POST /api/v1/things',
        'PUT /api/v1/things/{}',
        'POST /api/v1/things/read',
        'POST /broadcasting/batch',
    ])->and($unresolved)->toBe(['things.ts: where.toLowerCase()']);
});

it('names a call whose method or path has no route', function () {
    $routes = [
        ['method' => 'GET', 'uri' => '/api/v1/users/{user}'],
        ['method' => 'POST', 'uri' => '/api/v1/work-items/query'],
    ];
    $call = fn (string $method, string $path) => ['file' => 'x.ts', 'method' => $method, 'path' => $path, 'web' => false];

    expect(UiApiCalls::unmatched([
        $call('GET', '/api/v1/users/{}'),
        $call('GET', '/api/v1/users/me'),
        $call('POST', '/api/v1/work-items/query'),
        // a value the code only knows is no fixed word of a route
        $call('POST', '/api/v1/work-items/{}'),
        $call('PATCH', '/api/v1/users/{}'),
        $call('GET', '/api/v1/users'),
        $call('GET', '/api/v1/users/{}/role'),
    ], $routes))->toBe([
        'POST /api/v1/work-items/{} (x.ts)',
        'PATCH /api/v1/users/{} (x.ts)',
        'GET /api/v1/users (x.ts)',
        'GET /api/v1/users/{}/role (x.ts)',
    ]);
});
