<?php

namespace App\Mcp\Support;

use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

/**
 * The arguments of a tool call, read from the JSON body of the HTTP request (`params.arguments`): after TrimStrings
 * (which leaves the text nodes of rich text alone, `RichTextInput::RAW_KEYS`) and ConvertEmptyStringsToNull, so a tool
 * gets its input as clean as REST does (A149). Never from the arguments of the package's request, which are raw.
 *
 * An action whose twin is a `GET` hands its query to the action through `query()`, never `all()`: lists and the short
 * form take a value only as text (K6).
 */
final readonly class McpArguments
{
    /** @param  array<string, mixed>  $arguments */
    private function __construct(private array $arguments) {}

    public static function from(Request $http): self
    {
        $arguments = $http->json('params.arguments');

        return new self(is_array($arguments) ? $arguments : []);
    }

    public function action(): ?string
    {
        $action = $this->arguments['action'] ?? null;

        return is_string($action) ? $action : null;
    }

    /**
     * The body of the REST twin (`input`), an empty one if the call sent none.
     *
     * @return array<string, mixed>
     */
    public function input(): array
    {
        $input = $this->arguments['input'] ?? null;

        return is_array($input) ? $input : [];
    }

    public function get(string $key): mixed
    {
        return $this->arguments[$key] ?? null;
    }

    /**
     * @param  list<string>  $keys
     * @return array<string, mixed>
     */
    public function only(array $keys): array
    {
        return array_intersect_key($this->arguments, array_flip($keys));
    }

    /**
     * A reference (`project`, `item`, a ULID) the action needs: anything but text is the 422 of a missing field.
     *
     * @throws ValidationException
     */
    public function reference(string $key): string
    {
        $value = $this->arguments[$key] ?? null;

        return is_string($value) ? $value : throw ValidationException::withMessages([$key => __('field.required')]);
    }

    /** @return array<string, mixed> */
    public function all(): array
    {
        return $this->arguments;
    }

    /**
     * The same arguments with the defaults of the action for those the call left out (or sent as null).
     */
    public function withDefaults(McpAction $action): self
    {
        $missing = array_filter($action->defaultArguments(), fn (string $key): bool => ($this->arguments[$key] ?? null) === null, ARRAY_FILTER_USE_KEY);

        return new self([...$this->arguments, ...$missing]);
    }

    /**
     * The arguments named by `$keys` in the shape of a REST query, as the browser sends one (`toQueryString` in
     * resources/js/api/http.ts): a list as comma text, a boolean as `1`/`0`, a number as text, an object (`filter`)
     * one level deep. A missing argument, `null` and an empty list stay out.
     *
     * @param  list<string>  $keys
     * @return array<string, string|array<string, string>>
     */
    public function query(array $keys): array
    {
        $query = [];

        foreach ($keys as $key) {
            $value = $this->arguments[$key] ?? null;

            if (is_array($value) && ! array_is_list($value)) {
                $nested = array_filter(array_map(self::text(...), $value), fn (?string $text): bool => $text !== null);
                if ($nested !== []) {
                    $query[$key] = $nested;
                }

                continue;
            }

            $text = self::text($value);
            if ($text !== null) {
                $query[$key] = $text;
            }
        }

        return $query;
    }

    /**
     * One value of a query as text; `null` for nothing to send.
     */
    private static function text(mixed $value): ?string
    {
        return match (true) {
            $value === null => null,
            is_bool($value) => $value ? '1' : '0',
            is_string($value) => $value,
            is_int($value), is_float($value) => (string) $value,
            is_array($value) && array_is_list($value) => self::listText($value),
            default => (string) json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
        };
    }

    /**
     * @param  list<mixed>  $values
     */
    private static function listText(array $values): ?string
    {
        $texts = array_filter(array_map(self::text(...), $values), fn (?string $text): bool => $text !== null);

        return $texts === [] ? null : implode(',', $texts);
    }
}
