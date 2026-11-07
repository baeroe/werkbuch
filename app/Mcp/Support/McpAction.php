<?php

namespace App\Mcp\Support;

use App\Support\Actor;
use Closure;
use Illuminate\Support\Str;

/**
 * One action of an MCP tool (`tool:action`): its name, a sentence for the schema, what it runs and the REST operation it
 * mirrors. `$run` is `fn (Actor, McpArguments): McpResult`; it reads arguments, resolves references, calls **one**
 * action and returns its resource or body, nothing else (no logic in tools).
 *
 * - `$parameters`: argument → JSON Schema (the placeholders of the twin, the query of a `GET` twin);
 * - `$input`: the JSON Schema of the body (`input`) as the OpenAPI document gives it, with `#/components/schemas`
 *   references (task 3b reduces them);
 * - `$required`: the arguments the action needs besides `action`;
 * - `$twin`: the REST operation, method and URI as `Route::uri()` has it without `api/v1` (`POST work-items/{item}/transition`);
 * - `$path`: placeholder → argument, by default the placeholder in snake_case (`{pageVersion}` → `page_version`);
 * - `$defaults`: argument → value for an argument the call leaves out. An action with the argument `per_page` reads
 *   `PER_PAGE` items a page unless `$defaults` says otherwise (K8: a smaller page than REST's 100 in the context of a model);
 * - `$body`: `fn (McpArguments): array`, the body of the twin built from arguments of their own, for an action that
 *   reads through a body without `input` (`views:items` → `POST work-items/query` with `view_id`); `$run` builds its
 *   call with it too, so the action and the body REST would get are one (`twinBody()`).
 */
final readonly class McpAction
{
    public const PER_PAGE = 25;

    /**
     * @param  Closure(Actor, McpArguments): McpResult  $run
     * @param  array<string, array<string, mixed>>  $parameters
     * @param  array<string, mixed>|null  $input
     * @param  list<string>  $required
     * @param  array<string, string>  $path
     * @param  array<string, mixed>  $defaults
     * @param  (Closure(McpArguments): array<string, mixed>)|null  $body
     */
    public function __construct(
        public string $name,
        public string $summary,
        public Closure $run,
        public array $parameters = [],
        public ?array $input = null,
        public array $required = [],
        public ?string $twin = null,
        public array $path = [],
        public array $defaults = [],
        public ?Closure $body = null,
    ) {}

    /**
     * The body the twin gets for these arguments: what `$body` builds, else `input`.
     *
     * @return array<string, mixed>
     */
    public function twinBody(McpArguments $args): array
    {
        return $this->body === null ? $args->input() : ($this->body)($args);
    }

    /**
     * The values an argument the call leaves out takes: `$defaults`, and `per_page` for an action that has it.
     *
     * @return array<string, mixed>
     */
    public function defaultArguments(): array
    {
        return [
            ...array_key_exists('per_page', $this->parameters) ? ['per_page' => self::PER_PAGE] : [],
            ...$this->defaults,
        ];
    }

    /**
     * The path of the twin with its placeholders filled from the arguments, as the paginator names it over REST
     * (`meta.path`); `null` without a twin.
     */
    public function twinPath(McpArguments $args): ?string
    {
        if ($this->twin === null) {
            return null;
        }

        $uri = Str::after($this->twin, ' ');
        $filled = preg_replace_callback('/\{(\w+)\}/', function (array $match) use ($args): string {
            $value = $args->get($this->path[$match[1]] ?? Str::snake($match[1]));

            return is_scalar($value) ? rawurlencode((string) $value) : '';
        }, $uri);

        return url('api/v1/'.$filled);
    }
}
