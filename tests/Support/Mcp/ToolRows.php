<?php

namespace Tests\Support\Mcp;

use App\Mcp\Servers\WerkbuchServer;
use App\Mcp\Support\McpAction;
use App\Mcp\Support\McpArguments;
use App\Mcp\Support\WerkbuchTool;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Routing\Route as RoutingRoute;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Str;
use InvalidArgumentException;
use ReflectionClass;
use stdClass;
use Tests\Feature\Access\MatrixWorld;

/**
 * The rows of the tool matrix, in two suites: `werkbuch`, the tools of /mcp with tests/Feature/Mcp/tools.php, and
 * `twins`, the tools of the twin server with tests/Support/Mcp/twins.php (they run the whole harness before the areas
 * bring their tools). A row is `"tool:action" => ['arguments' => fn (MatrixWorld $w) => [...]]`; a row whose call the
 * action refuses on purpose names the refusal, `'refuses' => ['status' => 409, 'reason' => 'in_use']`. Every other row
 * has to succeed: a row with wrong arguments would otherwise only ever check the shape of a problem.
 */
final class ToolRows
{
    public const SUITES = [
        'werkbuch' => ['server' => WerkbuchServer::class, 'path' => '/mcp', 'rows' => __DIR__.'/../../Feature/Mcp/tools.php'],
        'twins' => ['server' => TwinServer::class, 'path' => '/'.TwinServer::PATH, 'rows' => __DIR__.'/twins.php'],
    ];

    /** The statuses a row may name as its refusal. */
    public const REFUSALS = [409, 422];

    /**
     * @return array<string, array{arguments?: Closure(MatrixWorld): array<string, mixed>, refuses?: array{status: int, reason: string}}>
     */
    public static function rows(string $suite): array
    {
        return require self::suite($suite)['rows'];
    }

    /**
     * Every row of every suite, `"<suite> <tool:action>" => [suite, key]`; with `$write` only the rows of write tools
     * (`manage-…`, `get-upload-url`) or only those of read tools, by their names (McpServerTest holds names and abilities
     * together).
     *
     * @return array<string, array{0: string, 1: string}>
     */
    public static function dataset(?bool $write = null): array
    {
        $dataset = [];

        foreach (array_keys(self::SUITES) as $suite) {
            foreach (array_keys(self::rows($suite)) as $key) {
                $tool = Str::before($key, ':');
                $writes = str_starts_with($tool, 'manage-') || $tool === 'get-upload-url';
                if ($write === null || $write === $writes) {
                    $dataset["{$suite} {$key}"] = [$suite, $key];
                }
            }
        }

        return $dataset;
    }

    /** The path of the server of a suite (`McpClient::for(..., path: …)`). */
    public static function path(string $suite): string
    {
        return self::suite($suite)['path'];
    }

    /**
     * The tools of the server of a suite, in its order.
     *
     * @return list<WerkbuchTool>
     */
    public static function tools(string $suite): array
    {
        /** @var list<class-string<WerkbuchTool>> $classes */
        $classes = (new ReflectionClass(self::suite($suite)['server']))->getDefaultProperties()['tools'];

        return array_map(fn (string $class): WerkbuchTool => app($class), $classes);
    }

    /**
     * Every action of the tools of a suite as `tool:action`.
     *
     * @return list<string>
     */
    public static function keys(string $suite): array
    {
        $keys = [];
        foreach (self::tools($suite) as $tool) {
            foreach ($tool->actionNames() as $name) {
                $keys[] = $tool->name().':'.$name;
            }
        }

        return $keys;
    }

    /**
     * The tool and the action of a row.
     *
     * @return array{0: WerkbuchTool, 1: McpAction}
     */
    public static function action(string $suite, string $key): array
    {
        [$name, $action] = explode(':', $key, 2);

        foreach (self::tools($suite) as $tool) {
            if ($tool->name() === $name && ($found = $tool->actionNamed($action)) !== null) {
                return [$tool, $found];
            }
        }

        throw new InvalidArgumentException("No action [{$key}] in the suite [{$suite}].");
    }

    /**
     * The arguments of the call of a row: those of the row, and `action` for a tool with several actions.
     *
     * @return array<string, mixed>
     */
    public static function arguments(string $suite, string $key, MatrixWorld $w): array
    {
        [$tool] = self::action($suite, $key);
        $row = self::rows($suite)[$key];
        $arguments = isset($row['arguments']) ? ($row['arguments'])($w) : [];

        return count($tool->actionNames()) > 1 ? ['action' => Str::after($key, ':'), ...$arguments] : $arguments;
    }

    /**
     * The refusal a row names, `null` for a row that has to succeed.
     *
     * @return array{status: int, reason: string}|null
     */
    public static function refusal(string $suite, string $key): ?array
    {
        return self::allowed($key, self::rows($suite)[$key]['refuses'] ?? null);
    }

    /**
     * A refusal a row names, if its status may be named.
     *
     * @param  array{status: int, reason: string}|null  $refuses
     * @return array{status: int, reason: string}|null
     */
    public static function allowed(string $key, ?array $refuses): ?array
    {
        // a refusal of rights or a server error would hide a wrong row: rights show in the token columns of the matrix
        if ($refuses !== null && ! in_array($refuses['status'], self::REFUSALS, true)) {
            throw new InvalidArgumentException("The row [{$key}] refuses with {$refuses['status']}; only ".implode(' and ', self::REFUSALS).' may be named.');
        }

        return $refuses;
    }

    /**
     * The result of a call is what its row says: a success, or exactly the refusal the row names (status and reason).
     *
     * @param  array{status: int, reason: string}|null  $refuses
     */
    public static function expectOutcome(stdClass $result, ?array $refuses, string $context): void
    {
        if ($refuses === null) {
            expect($result->isError)->toBeFalse("{$context} has to succeed: ".json_encode($result->structuredContent ?? null));

            return;
        }

        expect($result->isError)->toBeTrue("{$context} has to be refused")
            ->and([$result->structuredContent->status ?? null, $result->structuredContent->reason ?? null])->toBe([$refuses['status'], $refuses['reason']], $context);
    }

    /**
     * Arguments as a tool reads them from the body of the request.
     *
     * @param  array<string, mixed>  $arguments
     */
    public static function read(array $arguments): McpArguments
    {
        return McpArguments::from(Request::create('/mcp', 'POST', server: ['CONTENT_TYPE' => 'application/json'],
            content: (string) json_encode(['params' => ['arguments' => (object) $arguments]])));
    }

    /**
     * The method and URI of a twin (`POST work-items/{item}/transition` → `['POST', 'work-items/{item}/transition']`).
     *
     * @return array{0: string, 1: string}
     */
    public static function twin(McpAction $action): array
    {
        [$method, $uri] = explode(' ', (string) $action->twin, 2);

        return [$method, $uri];
    }

    /**
     * The arguments that fill the placeholders of the twin, by placeholder.
     *
     * @return array<string, string>
     */
    public static function pathArguments(McpAction $action): array
    {
        preg_match_all('/\{(\w+)}/', self::twin($action)[1], $matches);

        return array_combine($matches[1], array_map(fn (string $placeholder): string => $action->path[$placeholder] ?? Str::snake($placeholder), $matches[1]));
    }

    /** The REST route of a twin. */
    public static function route(McpAction $action): RoutingRoute
    {
        [$method, $uri] = self::twin($action);

        foreach (Route::getRoutes()->getRoutes() as $route) {
            if ($route->uri() === 'api/v1/'.$uri && in_array($method, $route->methods(), true)) {
                return $route;
            }
        }

        throw new InvalidArgumentException("No route [{$action->twin}].");
    }

    /**
     * @return array{server: class-string, path: string, rows: string}
     */
    private static function suite(string $suite): array
    {
        return self::SUITES[$suite] ?? throw new InvalidArgumentException("No suite [{$suite}].");
    }
}
