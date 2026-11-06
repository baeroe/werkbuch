<?php

use App\Http\Api\ListOf;
use App\Support\ListSpec;
use Illuminate\Http\Request;
use Illuminate\Routing\Route as RouteDefinition;
use Illuminate\Support\Facades\Route;
use Symfony\Component\HttpKernel\Exception\HttpException;

/*
 * The API guide (docs/{en,de}/api.md, Task 16) tells what the code does: its table of lists names exactly the filters,
 * sorts, default order and includes of every list's `ListSpec` (A386), and every `curl` of the page goes to a route.
 */

/**
 * The rows of the table of lists, between `<!-- lists:start -->` and `<!-- lists:end -->`: `GET /<uri>` → the names in
 * code of each cell, without what stands in parentheses (the values a filter takes).
 *
 * @return array<string, array{filters: list<string>, sorts: list<string>, default: list<string>, includes: list<string>}>
 */
$table = function (string $language): array {
    $page = (string) file_get_contents(repo_path("docs/{$language}/api.md"));
    expect(preg_match('/<!-- lists:start -->(.*)<!-- lists:end -->/s', $page, $section))->toBe(1, "{$language}: the table of lists");

    $names = fn (string $cell): array => preg_match_all('/`([^`]+)`/', (string) preg_replace('/\([^)]*\)/', '', $cell), $m) ? $m[1] : [];
    $rows = [];
    foreach (explode("\n", $section[1]) as $line) {
        if (! preg_match('/^\| `GET (\/[^`]+)` \|/', $line, $route)) {
            continue;
        }
        $cells = array_map('trim', explode('|', trim($line, ' |')));
        expect($cells)->toHaveCount(5, "{$language}: {$line}");
        $rows["GET {$route[1]}"] = ['filters' => $names($cells[1]), 'sorts' => $names($cells[2]), 'default' => $names($cells[3]), 'includes' => $names($cells[4])];
    }

    return $rows;
};

/**
 * Every list of the API (`#[ListOf]` on its controller method) with what its spec allows.
 *
 * @return array<string, array{filters: list<string>, sorts: list<string>, default: list<string>, includes: list<string>}>
 */
$lists = function (): array {
    $lists = [];
    foreach (Route::getRoutes()->getRoutes() as $route) {
        /** @var RouteDefinition $route */
        $uses = $route->getAction('uses');
        if (! str_starts_with($route->uri(), 'api/v1/') || ! is_string($uses) || ! str_contains($uses, '@')) {
            continue;
        }
        [$controller, $method] = explode('@', $uses);
        $attribute = (new ReflectionMethod($controller, $method))->getAttributes(ListOf::class)[0] ?? null;
        if ($attribute === null) {
            continue;
        }
        $spec = $attribute->newInstance()->spec();
        expect($spec)->toBeInstanceOf(ListSpec::class, $uses);
        /** @var ListSpec $spec */
        $lists['GET '.substr($route->uri(), strlen('api/v1'))] = [
            'filters' => array_keys($spec->filters),
            // a fixed list and one without `sort` (the inbox, the log) take no sort parameter
            'sorts' => $spec->fixed || ! $spec->sortable ? [] : array_keys($spec->sorts),
            'default' => $spec->default,
            'includes' => $spec->includes,
        ];
    }

    return $lists;
};

it('names the filters, sorts and includes of every list in the guide', function () use ($table, $lists) {
    $expected = $lists();
    expect($expected)->toHaveKey('GET /projects')->toHaveKey('GET /notifications');

    foreach (['en', 'de'] as $language) {
        $rows = $table($language);
        expect(array_keys($rows))->toEqualCanonicalizing(array_keys($expected), "{$language}: the lists of the table");
        foreach ($expected as $list => $rules) {
            expect($rows[$list])->toBe($rules, "{$language}: {$list}");
        }
    }
});

it('sends every curl of the guide to a route of the api', function () {
    foreach (['en', 'de'] as $language) {
        $page = (string) file_get_contents(repo_path("docs/{$language}/api.md"));
        preg_match_all('/```bash\n(.*?)```/s', $page, $blocks);
        $calls = [];
        foreach ($blocks[1] as $block) {
            // one command per `curl`, its continued lines joined
            foreach (preg_split('/(?=^curl )/m', str_replace("\\\n", ' ', $block)) ?: [] as $command) {
                if (! preg_match('#https://werkbuch\.example\.com(/api/[^\s"\'?]*)#', $command, $url)) {
                    continue;
                }
                $method = preg_match('/-X (\w+)/', $command, $x) ? $x[1] : (preg_match('/ (-d|-F|--data[\w-]*) /', $command) ? 'POST' : 'GET');
                $calls[] = [$method, $url[1]];
            }
        }
        expect(count($calls))->toBeGreaterThanOrEqual(6, "{$language}: the examples with curl");

        foreach ($calls as [$method, $path]) {
            try {
                $route = Route::getRoutes()->match(Request::create($path, $method));
            } catch (HttpException $e) {
                $route = null;
            }
            expect($route?->uri() ?? 'no route')->toStartWith('api/', "{$language}: {$method} {$path}");
        }
    }
});
