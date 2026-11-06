<?php

namespace Tests\Support;

/**
 * Reads the calls of the interface to the API out of the TypeScript of resources/js/api (UiApiCoverageTest): every call
 * of a function of `./http` with the path it sends, the path as a template with `{}` for every value that only the
 * running code knows (`${encodeURIComponent(id)}`, `${user_id}`). It follows what the files write: aliases of the
 * import (`patch as sendPatch`), helpers that build a path (`const itemPath = (id: string) => \`/work-items/${…}\``,
 * also from another file), constants of a path (`const path = \`${itemPath(id)}/subscription\``), a choice of words in a
 * template (`${archived ? 'archive' : 'restore'}`) and wrappers that take the path as their first parameter
 * (`function save(path: string, …)`, then every call of the wrapper). A path it cannot read is `unresolved`: the test
 * fails then, and the file names the path as a constant or a helper instead.
 */
final class UiApiCalls
{
    /** The functions of resources/js/api/http.ts that send a request, with their methods (`saveOne`: create or replace). */
    public const METHODS = [
        'get' => ['GET'], 'getPage' => ['GET'],
        'post' => ['POST'], 'postPage' => ['POST'], 'readPost' => ['POST'], 'upload' => ['POST'], 'webPost' => ['POST'],
        'patch' => ['PATCH'], 'put' => ['PUT'], 'del' => ['DELETE'], 'saveOne' => ['POST', 'PUT'],
    ];

    /** The one function whose path is no path of the API but of the web routes (`/broadcasting/batch`). */
    private const WEB = 'webPost';

    /** @var array<string, list<array{name: string, at: int, params: list<string>|null, expr: string}>> */
    private array $consts = [];

    /** @var list<string> */
    private array $unresolved = [];

    /**
     * @param  array<string, string>  $sources  file name → TypeScript
     */
    private function __construct(array $sources)
    {
        foreach ($sources as $file => $source) {
            $this->consts[$file] = self::constsOf($source);
        }
    }

    /**
     * @param  array<string, string>  $sources  file name → TypeScript
     * @return array{calls: list<array{file: string, method: string, path: string, web: bool}>, unresolved: list<string>}
     */
    public static function of(array $sources): array
    {
        $reader = new self($sources);
        $calls = [];

        foreach ($sources as $file => $source) {
            array_push($calls, ...$reader->callsOf($file, $source));
        }

        return ['calls' => $calls, 'unresolved' => $reader->unresolved];
    }

    /**
     * The calls whose method and path no route has (`"<METHOD> <path>"`, the path with `{}`). A `{}` of the call matches
     * only a parameter of the route; a word of the call matches the same word or a parameter.
     *
     * @param  list<array{file: string, method: string, path: string, web: bool}>  $calls
     * @param  list<array{method: string, uri: string}>  $routes  the methods and URIs of the routes (`api/v1/users/{user}`)
     * @return list<string>
     */
    public static function unmatched(array $calls, array $routes): array
    {
        $missing = [];

        foreach ($calls as $call) {
            $found = false;

            foreach ($routes as $route) {
                if ($route['method'] === $call['method'] && self::matches($call['path'], $route['uri'])) {
                    $found = true;
                    break;
                }
            }

            if (! $found) {
                $missing[] = "{$call['method']} {$call['path']} ({$call['file']})";
            }
        }

        return array_values(array_unique($missing));
    }

    private static function matches(string $path, string $uri): bool
    {
        $wanted = explode('/', trim($path, '/'));
        $offered = explode('/', trim($uri, '/'));

        if (count($wanted) !== count($offered)) {
            return false;
        }

        foreach ($wanted as $index => $segment) {
            $parameter = preg_match('/^\{\w+\??\}$/', $offered[$index]) === 1;

            if (! $parameter && $segment !== $offered[$index]) {
                return false;
            }
        }

        return true;
    }

    /**
     * @return list<array{file: string, method: string, path: string, web: bool}>
     */
    private function callsOf(string $file, string $source): array
    {
        $aliases = self::aliasesOf($source);
        $wrappers = self::wrappersOf($source);
        $calls = [];

        foreach ($aliases as $local => $function) {
            foreach (self::callSites($source, $local) as [$at, $argument]) {
                $wrapper = self::wrapperAround($wrappers, $at, $argument);
                $paths = $wrapper === null
                    ? $this->resolve($file, $at, $argument, true)
                    : $this->wrapperPaths($file, $source, $wrapper);

                foreach ($paths as $path) {
                    $path = (string) preg_replace('/\?.*$/', '', $path);

                    foreach (self::METHODS[$function] as $index => $method) {
                        // `saveOne(path, id, body)`: a new one is a POST to the path, a change a PUT to path/id
                        $calls[] = [
                            'file' => $file,
                            'method' => $method,
                            'path' => ($function === self::WEB ? '' : '/api/v1').$path.($function === 'saveOne' && $index === 1 ? '/{}' : ''),
                            'web' => $function === self::WEB,
                        ];
                    }
                }
            }
        }

        return $calls;
    }

    /**
     * The local names of the request functions imported from `./http`.
     *
     * @return array<string, string> local name → function
     */
    private static function aliasesOf(string $source): array
    {
        $aliases = [];

        if (preg_match('/import\s*\{([^}]*)\}\s*from\s*[\'"]\.\/http[\'"]/', $source, $import) === 1) {
            foreach (explode(',', $import[1]) as $entry) {
                $parts = preg_split('/\s+as\s+/', trim($entry)) ?: [];
                $function = trim($parts[0] ?? '');

                if (isset(self::METHODS[$function])) {
                    $aliases[trim($parts[1] ?? $function)] = $function;
                }
            }
        }

        return $aliases;
    }

    /**
     * Where a function is called and the text of its first argument.
     *
     * @return list<array{0: int, 1: string}>
     */
    private static function callSites(string $source, string $name): array
    {
        $sites = [];
        preg_match_all('/(?<![\w.$])'.preg_quote($name, '/').'\b/', $source, $found, PREG_OFFSET_CAPTURE);

        foreach ($found[0] as [, $at]) {
            if (preg_match('/function\s+$/', substr($source, max(0, $at - 20), min(20, $at))) === 1) {
                continue;
            }

            $open = self::skipGenerics($source, $at + strlen($name));

            if ($open === null || ($source[$open] ?? '') !== '(') {
                continue;
            }

            [$argument] = self::scan($source, $open + 1, [',', ')']);
            $sites[] = [$at, trim($argument)];
        }

        return $sites;
    }

    /** The position after whitespace and type arguments (`<{ data: User }>`) following a name, or null. */
    private static function skipGenerics(string $source, int $at): ?int
    {
        while (ctype_space($source[$at] ?? 'x')) {
            $at++;
        }

        if (($source[$at] ?? '') !== '<') {
            return $at;
        }

        // type arguments are short: a `<` that opens nothing within 200 characters is a comparison
        for ($depth = 0, $end = min(strlen($source), $at + 200); $at < $end; $at++) {
            $char = $source[$at];

            if ($char === '<') {
                $depth++;
            } elseif ($char === '>' && $source[$at - 1] !== '=' && --$depth === 0) {
                return self::skipGenerics($source, $at + 1);
            }
        }

        return null;
    }

    /**
     * Reads an expression up to the first of `$stops` outside brackets, strings and templates.
     *
     * @param  list<string>  $stops
     * @return array{0: string, 1: int} the text and the position of the stop
     */
    private static function scan(string $source, int $at, array $stops): array
    {
        $start = $at;
        $depth = 0;

        for ($length = strlen($source); $at < $length; $at++) {
            $char = $source[$at];

            if ($char === "'" || $char === '"') {
                $at = self::endOfString($source, $at, $char);
            } elseif ($char === '`') {
                $at = self::endOfTemplate($source, $at);
            } elseif (in_array($char, ['(', '[', '{'], true)) {
                $depth++;
            } elseif ($depth > 0 && in_array($char, [')', ']', '}'], true)) {
                $depth--;
            } elseif ($depth === 0 && in_array($char, $stops, true)) {
                return [substr($source, $start, $at - $start), $at];
            }
        }

        return [substr($source, $start), $at];
    }

    private static function endOfString(string $source, int $at, string $quote): int
    {
        for ($at++, $length = strlen($source); $at < $length && $source[$at] !== $quote; $at++) {
            if ($source[$at] === '\\') {
                $at++;
            }
        }

        return $at;
    }

    private static function endOfTemplate(string $source, int $at): int
    {
        for ($at++, $length = strlen($source); $at < $length && $source[$at] !== '`'; $at++) {
            if ($source[$at] === '\\') {
                $at++;
            } elseif ($source[$at] === '$' && ($source[$at + 1] ?? '') === '{') {
                [, $at] = self::scan($source, $at + 2, ['}']);
            }
        }

        return $at;
    }

    /**
     * The constants of a file whose value may be a path: a string or template, or an arrow function returning one.
     *
     * @return list<array{name: string, at: int, params: list<string>|null, expr: string}>
     */
    private static function constsOf(string $source): array
    {
        $consts = [];
        preg_match_all('/\bconst\s+(\w+)\s*=\s*/', $source, $found, PREG_OFFSET_CAPTURE | PREG_SET_ORDER);

        foreach ($found as $match) {
            $name = $match[1][0];
            $at = $match[0][1] + strlen($match[0][0]);
            $params = null;

            if (preg_match('/\G\(([^()]*)\)\s*(?::\s*string\s*)?=>\s*/', $source, $arrow, 0, $at) === 1) {
                $params = array_values(array_filter(array_map(fn (string $param) => trim(explode(':', $param)[0]), explode(',', $arrow[1]))));
                $at += strlen($arrow[0]);
            }

            if (in_array($source[$at] ?? '', ['`', "'", '"'], true)) {
                [$expr] = self::scan($source, $at, [';', "\n"]);
                $consts[] = ['name' => $name, 'at' => $match[0][1], 'params' => $params, 'expr' => trim($expr)];
            }
        }

        return $consts;
    }

    /**
     * The functions that take a path as their first parameter (`function save(path: string, …)`), with their body.
     *
     * @return list<array{name: string, param: string, from: int, to: int}>
     */
    private static function wrappersOf(string $source): array
    {
        $wrappers = [];
        preg_match_all('/function\s+(\w+)\s*(?:<[^(]*>)?\s*\(\s*(\w+)\s*:\s*string\b/', $source, $found, PREG_OFFSET_CAPTURE | PREG_SET_ORDER);

        foreach ($found as $match) {
            $open = strpos($source, '(', $match[0][1]);
            [, $close] = self::scan($source, (int) $open + 1, [')']);
            $body = self::bodyStart($source, $close + 1);
            [, $end] = self::scan($source, $body + 1, ['}']);
            $wrappers[] = ['name' => $match[1][0], 'param' => $match[2][0], 'from' => $body, 'to' => $end];
        }

        return $wrappers;
    }

    /** The `{` of a body after the parameters, past a return type with braces of its own (`Promise<{ updated: number }>`). */
    private static function bodyStart(string $source, int $at): int
    {
        for ($angles = 0, $length = strlen($source); $at < $length; $at++) {
            $char = $source[$at];

            if ($char === '<') {
                $angles++;
            } elseif ($char === '>' && $source[$at - 1] !== '=') {
                $angles--;
            } elseif ($char === '{' && $angles === 0) {
                return $at;
            }
        }

        return $at;
    }

    /**
     * @param  list<array{name: string, param: string, from: int, to: int}>  $wrappers
     * @return array{name: string, param: string, from: int, to: int}|null
     */
    private static function wrapperAround(array $wrappers, int $at, string $argument): ?array
    {
        foreach ($wrappers as $wrapper) {
            if ($argument === $wrapper['param'] && $at > $wrapper['from'] && $at < $wrapper['to']) {
                return $wrapper;
            }
        }

        return null;
    }

    /**
     * The paths every call of a wrapper hands to it.
     *
     * @param  array{name: string, param: string, from: int, to: int}  $wrapper
     * @return list<string>
     */
    private function wrapperPaths(string $file, string $source, array $wrapper): array
    {
        $paths = [];

        foreach (self::callSites($source, $wrapper['name']) as [$at, $argument]) {
            array_push($paths, ...$this->resolve($file, $at, $argument, true));
        }

        if ($paths === []) {
            $this->unresolved[] = "{$file}: {$wrapper['name']}() is never called";
        }

        return $paths;
    }

    /**
     * The paths an expression can be. On the top level (the argument of a call) anything unreadable is unresolved;
     * inside `${…}` it is a value of the running code, `{}`.
     *
     * @return list<string>
     */
    private function resolve(string $file, int $at, string $expr, bool $top): array
    {
        $expr = trim($expr);

        while (str_starts_with($expr, '(') && self::scan($expr, 1, [')'])[1] === strlen($expr) - 1) {
            $expr = trim(substr($expr, 1, -1));
        }

        if (($choice = self::ternary($expr)) !== null) {
            return [...$this->resolve($file, $at, $choice[0], $top), ...$this->resolve($file, $at, $choice[1], $top)];
        }

        if (preg_match('/^([\'"])(.*)\1$/s', $expr, $literal) === 1) {
            return [$literal[2]];
        }

        if (str_starts_with($expr, '`') && self::endOfTemplate($expr, 0) === strlen($expr) - 1) {
            return $this->template($file, $at, substr($expr, 1, -1));
        }

        if (preg_match('/^(\w+)(\(.*\))?$/s', $expr, $named) === 1) {
            $const = $this->constNamed($file, $at, $named[1], isset($named[2]));

            if ($const !== null) {
                return $this->resolve($const['file'], $const['at'], $const['expr'], $top);
            }
        }

        if ($top) {
            $this->unresolved[] = "{$file}: {$expr}";

            return [];
        }

        return ['{}'];
    }

    /**
     * @return list<string>
     */
    private function template(string $file, int $at, string $body): array
    {
        $paths = [''];

        for ($index = 0, $length = strlen($body); $index < $length; $index++) {
            if ($body[$index] === '$' && ($body[$index + 1] ?? '') === '{') {
                [$inner, $index] = self::scan($body, $index + 2, ['}']);
                $parts = $this->resolve($file, $at, $inner, false);
            } else {
                $parts = [$body[$index]];
            }

            $paths = array_merge(...array_map(fn (string $path) => array_map(fn (string $part) => $path.$part, $parts), $paths));
        }

        return array_values(array_unique($paths));
    }

    /**
     * `a ? b : c` on the top level of the expression, as `[b, c]`.
     *
     * @return array{0: string, 1: string}|null
     */
    private static function ternary(string $expr): ?array
    {
        [$condition, $question] = self::scan($expr, 0, ['?']);

        while ($question < strlen($expr) && in_array($expr[$question + 1] ?? '', ['.', '?'], true)) {
            [, $question] = self::scan($expr, $question + 2, ['?']);
        }

        if ($question >= strlen($expr) || $condition === '') {
            return null;
        }

        [$then, $colon] = self::scan($expr, $question + 1, [':']);

        return $colon >= strlen($expr) ? null : [$then, substr($expr, $colon + 1)];
    }

    /**
     * A constant of the file before the place (the nearest), else a helper of another file (an arrow function).
     *
     * @return array{file: string, at: int, expr: string}|null
     */
    private function constNamed(string $file, int $at, string $name, bool $called): ?array
    {
        $fits = fn (array $const) => $const['name'] === $name && ($const['params'] !== null) === $called;
        $here = array_values(array_filter($this->consts[$file], fn (array $const) => $fits($const) && $const['at'] < $at));

        if ($here !== []) {
            $const = end($here);

            return ['file' => $file, 'at' => $const['at'], 'expr' => $const['expr']];
        }

        foreach ($this->consts as $other => $consts) {
            foreach ($consts as $const) {
                if ($called && $fits($const)) {
                    return ['file' => $other, 'at' => $const['at'], 'expr' => $const['expr']];
                }
            }
        }

        return null;
    }
}
