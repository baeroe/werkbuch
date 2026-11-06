<?php

namespace Tests\Support\OpenApi;

use Illuminate\Http\Request;
use Illuminate\Routing\Route;
use InvalidArgumentException;
use Opis\JsonSchema\CompliantValidator;
use Opis\JsonSchema\Errors\ErrorFormatter;
use Opis\JsonSchema\Parsers\SchemaParser;
use Opis\JsonSchema\Resolvers\SchemaResolver;
use Opis\JsonSchema\SchemaLoader;
use Opis\JsonSchema\Validator;
use PHPUnit\Framework\AssertionFailedError;
use stdClass;
use Symfony\Component\HttpFoundation\Response;

/**
 * The OpenAPI document as a contract (A385): `RecordContract` hands every answer a feature test gets under `/api/v1`
 * to `record()`, and `TestCase::tearDown` asks `assertClean()`. Only then (K3: never in the measured time of a
 * request) each exchange is checked against the document: the status is documented, a JSON answer is valid against the
 * schema of its status and media type, and for a success the JSON body of the request is valid against the request
 * schema (Draft 2020-12 with opis, `$ref` resolved over the whole document).
 *
 * Every object of a response or request schema is closed with `unevaluatedProperties: false` at its outermost place
 * (K2): the branches of `allOf`, `anyOf` and `oneOf` and the components a `$ref` names stay open, so an `allOf` of a
 * resource and `additional()` takes the keys of both. A schema with `x-werkbuch-open` stays open with everything
 * under it (the extensions of a problem, the nodes of a Tiptap document, the free keys of `values`).
 *
 * Only operations with a tag of `STRICT_TAGS` report; an operation the document does not have always does.
 */
final class Contract
{
    /**
     * The tags whose operations must keep the contract; Tasks 8–12 add theirs, Task 14 makes it all of them.
     *
     * @var list<string>
     */
    public const STRICT_TAGS = ['Organization', 'Users', 'Bots', 'Invitations', 'Tokens', 'Me', 'Password', 'TwoFactor', 'Projects', 'Members', 'Favorites', 'Automations', 'Workflows', 'StateUsage', 'WorkItemTypes', 'Properties', 'Labels', 'RelationTypes', 'Resolutions'];

    private const ID = 'https://werkbuch.invalid/openapi.json';

    /** The keywords whose values are maps of schemas at places of data (a key of an object). */
    private const MAPS = ['properties', 'patternProperties'];

    /** The keywords whose value is one schema at a place of data. */
    private const ONE = ['items', 'additionalProperties', 'unevaluatedProperties', 'contains', 'unevaluatedItems', 'propertyNames'];

    /** The keywords whose schemas apply in place: their objects are closed by the schema around them. */
    private const BRANCHES = ['allOf', 'anyOf', 'oneOf'];

    private const IN_PLACE = ['not', 'if', 'then', 'else'];

    /** @var array{tree: object, validator: Validator, tags: list<string>|null}|null */
    private static ?array $real = null;

    /** @var array{tree: object, validator: Validator, tags: list<string>|null}|null */
    private static ?array $test = null;

    /** @var list<array{method: string, uri: string, status: int, type: string, body: string|null, sentType: string, sent: string|null}> */
    private static array $pending = [];

    /** @var list<string> */
    private static array $recorded = [];

    /** @var array<string, list<string>> */
    private static array $sent = [];

    /** @var list<string> */
    private static array $violations = [];

    private static ?string $off = null;

    /**
     * Check the exchanges against a document of the test instead of the generated one (every tag strict unless
     * `$strictTags` names them); `reset()` returns to the generated document.
     *
     * @param  array<string, mixed>  $document
     * @param  list<string>|null  $strictTags
     */
    public static function using(array $document, ?array $strictTags = null): void
    {
        self::$test = self::prepare($document, $strictTags);
    }

    /**
     * Switch the contract off for the running test; the reason says why this test sends or gets what the document does
     * not allow.
     */
    public static function off(string $reason): void
    {
        if (trim($reason) === '') {
            throw new InvalidArgumentException('Contract::off() needs a reason.');
        }

        self::$off = $reason;
    }

    /**
     * Forget the exchanges, the violations, a document of the test and `off()` (`TestCase` calls it around every test).
     */
    public static function reset(): void
    {
        self::$pending = [];
        self::$recorded = [];
        self::$sent = [];
        self::$violations = [];
        self::$test = null;
        self::$off = null;
    }

    /**
     * Keep one exchange of a route of the contract for the check: method, URI pattern, status, media types and the JSON
     * bodies (K3).
     */
    public static function record(Request $request, Response $response): void
    {
        $route = $request->route();

        if (self::$off !== null || ! $route instanceof Route) {
            return;
        }

        $method = $request->method() === 'HEAD' ? 'GET' : $request->method();
        $uri = '/'.ltrim(substr($route->uri(), strlen('api/v1')), '/');
        $type = self::mediaType((string) $response->headers->get('Content-Type'));
        $sentType = self::mediaType((string) $request->headers->get('Content-Type'));
        $body = self::isJson($type) ? $response->getContent() : null;

        self::$recorded[] = "{$method} {$uri} {$response->getStatusCode()}";
        self::noteSentKeys($method, $uri, $response->getStatusCode(), $request, $sentType);
        self::$pending[] = [
            'method' => $method,
            'uri' => $uri,
            'status' => $response->getStatusCode(),
            'type' => $type,
            'body' => $body === false ? null : $body,
            'sentType' => $sentType,
            'sent' => self::isJson($sentType) ? $request->getContent() : null,
        ];
    }

    /**
     * The top-level keys the successful requests (2xx) of an operation sent as a JSON object since the last `reset()`
     * (K15): a test that sends a full body proves with this that every key the document names is one a client can send.
     *
     * @return list<string>
     */
    public static function sentKeys(string $method, string $uri): array
    {
        return self::$sent[$method.' '.$uri] ?? [];
    }

    /**
     * What was recorded since the last `reset()`, `"<METHOD> <uri> <status>"`.
     *
     * @return list<string>
     */
    public static function recorded(): array
    {
        return self::$recorded;
    }

    private static function noteSentKeys(string $method, string $uri, int $status, Request $request, string $sentType): void
    {
        if ($status < 200 || $status >= 300 || ! self::isJson($sentType)) {
            return;
        }

        $body = json_decode($request->getContent(), true);

        if (is_array($body) && ! array_is_list($body)) {
            $key = $method.' '.$uri;
            self::$sent[$key] = array_values(array_unique([...(self::$sent[$key] ?? []), ...array_map('strval', array_keys($body))]));
        }
    }

    /**
     * The violations of the exchanges so far, one line each: `"<METHOD> <uri> <status>: <place in the body>: <error>"`.
     *
     * @return list<string>
     */
    public static function violations(): array
    {
        if (self::$off !== null) {
            return [];
        }

        $pending = self::$pending;
        self::$pending = [];

        if ($pending !== []) {
            $contract = self::$test ?? self::$real ??= self::prepare(Document::get(), self::STRICT_TAGS);

            foreach ($pending as $exchange) {
                foreach (self::check($contract, $exchange) as $violation) {
                    self::$violations[] = "{$exchange['method']} {$exchange['uri']} {$exchange['status']}: {$violation}";
                }
            }
        }

        return self::$violations;
    }

    /**
     * Fail with the list of violations, if there are any, and forget them.
     */
    public static function assertClean(): void
    {
        $violations = self::violations();
        self::reset();

        if ($violations !== []) {
            throw new AssertionFailedError("The answers break the OpenAPI document:\n".implode("\n", $violations));
        }
    }

    /**
     * The places of the operations with one of `$tags` (all with `null`) and of the components they name where a
     * schema lets anything through: `{}`, or an object without `properties`, `additionalProperties` or
     * `x-werkbuch-open` (`"<JSON pointer>: <what>"`).
     *
     * @param  array<string, mixed>  $document
     * @param  list<string>|null  $tags
     * @return list<string>
     */
    public static function emptySchemas(array $document, ?array $tags): array
    {
        // Scramble's document holds an empty schema as an object (`stdClass`): as arrays it reads `[]` (T3-I1)
        /** @var array<string, mixed> $document */
        $document = json_decode((string) json_encode($document), true);
        $found = [];
        $seen = [];

        foreach ($document['paths'] ?? [] as $path => $item) {
            foreach ($item as $method => $operation) {
                if (! is_array($operation) || ! isset($operation['responses']) || ! self::strict($operation, $tags)) {
                    continue;
                }

                $at = '#/paths/'.self::segment((string) $path).'/'.$method;

                foreach ($operation['responses'] as $status => $response) {
                    [$response, $where] = self::follow($document, $response, "{$at}/responses/{$status}", $seen);
                    foreach (is_array($response) ? $response['content'] ?? [] : [] as $type => $content) {
                        self::loose($document, $content['schema'] ?? null, $where.'/content/'.self::segment((string) $type).'/schema', $found, $seen);
                    }
                }

                if (isset($operation['requestBody'])) {
                    [$body, $where] = self::follow($document, $operation['requestBody'], "{$at}/requestBody", $seen);
                    foreach (is_array($body) ? $body['content'] ?? [] : [] as $type => $content) {
                        self::loose($document, $content['schema'] ?? null, $where.'/content/'.self::segment((string) $type).'/schema', $found, $seen);
                    }
                }
            }
        }

        return $found;
    }

    /**
     * @param  array{tree: object, validator: Validator, tags: list<string>|null}  $contract
     * @param  array{method: string, uri: string, status: int, type: string, body: string|null, sentType: string, sent: string|null}  $exchange
     * @return list<string>
     */
    private static function check(array $contract, array $exchange): array
    {
        $at = '/paths/'.self::segment($exchange['uri']).'/'.strtolower($exchange['method']);
        $operation = self::pointer($contract['tree'], $at);

        if (! $operation instanceof stdClass) {
            return ['the operation is not documented'];
        }
        if (! self::strict((array) $operation, $contract['tags'])) {
            return [];
        }

        $responses = $operation->responses ?? new stdClass;
        $status = (string) $exchange['status'];
        $key = match (true) {
            property_exists($responses, $status) => $status,
            property_exists($responses, $status[0].'XX') => $status[0].'XX',
            property_exists($responses, $status[0].'xx') => $status[0].'xx',
            property_exists($responses, 'default') => 'default',
            default => null,
        };

        if ($key === null) {
            return ['status is not documented'];
        }

        $violations = [];
        [, $where] = self::resolve($contract['tree'], $responses->{$key}, "{$at}/responses/".self::segment($key));

        if ($exchange['body'] !== null && $exchange['body'] !== '') {
            $violations = [...$violations, ...self::validate($contract, $where, $exchange['type'], $exchange['body'], '')];
        }

        if ($exchange['status'] >= 200 && $exchange['status'] < 300 && $exchange['sent'] !== null && ! in_array(trim($exchange['sent']), ['', '[]', '{}'], true)) {
            if (! isset($operation->requestBody)) {
                $violations[] = 'request: the operation takes no body';
            } else {
                [, $where] = self::resolve($contract['tree'], $operation->requestBody, "{$at}/requestBody");
                $violations = [...$violations, ...self::validate($contract, $where, $exchange['sentType'], $exchange['sent'], 'request ')];
            }
        }

        return $violations;
    }

    /**
     * Validate a JSON body against the schema of `$type` under the response or request body at `$where`.
     *
     * @param  array{tree: object, validator: Validator, tags: list<string>|null}  $contract
     * @return list<string>
     */
    private static function validate(array $contract, string $where, string $type, string $body, string $prefix): array
    {
        $content = self::pointer($contract['tree'], $where.'/content');
        $documented = $content instanceof stdClass ? array_keys(get_object_vars($content)) : [];
        $match = array_values(array_filter([$type, explode('/', $type)[0].'/*', '*/*'], fn (string $t) => in_array($t, $documented, true)))[0] ?? null;

        if ($match === null) {
            return ["{$prefix}media type {$type} is not documented"];
        }

        try {
            $data = json_decode($body, false, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return ["{$prefix}the body is no JSON"];
        }

        if (! isset($content->{$match}->schema)) {
            return [];
        }

        $error = $contract['validator']->validate($data, self::ID.'#'.self::fragment($where.'/content/'.self::segment($match).'/schema'))->error();

        if ($error === null) {
            return [];
        }

        $lines = [];
        foreach ((new ErrorFormatter)->formatKeyed($error) as $place => $messages) {
            $lines[] = $prefix.($place === '' ? '/' : $place).': '.implode('; ', array_unique($messages));
        }

        return $lines;
    }

    /**
     * The document as the validator reads it, every response and request schema closed (K2).
     *
     * @param  array<string, mixed>  $document
     * @param  list<string>|null  $tags
     * @return array{tree: object, validator: Validator, tags: list<string>|null}
     */
    private static function prepare(array $document, ?array $tags): array
    {
        /** @var object $tree */
        $tree = json_decode(json_encode($document, JSON_THROW_ON_ERROR | JSON_PRESERVE_ZERO_FRACTION), false, 512, JSON_THROW_ON_ERROR);

        foreach ((array) ($tree->paths ?? []) as $item) {
            foreach ((array) $item as $operation) {
                if (! $operation instanceof stdClass) {
                    continue;
                }
                foreach ((array) ($operation->responses ?? []) as $response) {
                    self::closeContent($tree, $response);
                }
                if (isset($operation->requestBody)) {
                    self::closeContent($tree, $operation->requestBody);
                }
            }
        }

        foreach (['responses', 'requestBodies'] as $kind) {
            foreach ((array) ($tree->components->{$kind} ?? []) as $component) {
                self::closeContent($tree, $component);
            }
        }

        // a component may stand in an allOf with other keys: its own top stays open, the place that names it closes
        foreach ((array) ($tree->components->schemas ?? []) as $schema) {
            self::close($tree, $schema, false);
        }

        $resolver = new SchemaResolver;
        $resolver->registerRaw($tree, self::ID);

        return [
            'tree' => $tree,
            'validator' => new CompliantValidator(new SchemaLoader(new SchemaParser, $resolver), 10, false),
            'tags' => $tags,
        ];
    }

    private static function closeContent(object $root, mixed $response): void
    {
        if (! $response instanceof stdClass || ! isset($response->content) || ! $response->content instanceof stdClass) {
            return;
        }

        foreach (get_object_vars($response->content) as $content) {
            if ($content instanceof stdClass && isset($content->schema)) {
                self::close($root, $content->schema, true);
            }
        }
    }

    /**
     * Close the object at a place of data (`$outer`) and every place of data under it.
     */
    private static function close(object $root, mixed $schema, bool $outer): void
    {
        if (! $schema instanceof stdClass || isset($schema->{'x-werkbuch-open'})) {
            return;
        }

        foreach ([...self::MAPS, '$defs', 'dependentSchemas'] as $keyword) {
            // PHP writes an empty map as a list
            if (isset($schema->{$keyword}) && $schema->{$keyword} === []) {
                $schema->{$keyword} = new stdClass;
            }
        }

        if ($outer && self::objectLike($schema) && ! property_exists($schema, 'unevaluatedProperties') && ! self::opens($root, $schema, [])) {
            $schema->unevaluatedProperties = false;
        }

        foreach (self::MAPS as $keyword) {
            foreach ((array) ($schema->{$keyword} ?? []) as $sub) {
                self::close($root, $sub, true);
            }
        }
        foreach (self::ONE as $keyword) {
            if (isset($schema->{$keyword})) {
                self::close($root, $schema->{$keyword}, true);
            }
        }
        foreach ((array) ($schema->prefixItems ?? []) as $sub) {
            self::close($root, $sub, true);
        }
        foreach (self::BRANCHES as $keyword) {
            foreach ((array) ($schema->{$keyword} ?? []) as $sub) {
                self::close($root, $sub, false);
            }
        }
        foreach (self::IN_PLACE as $keyword) {
            if (isset($schema->{$keyword})) {
                self::close($root, $schema->{$keyword}, false);
            }
        }
    }

    private static function objectLike(stdClass $schema): bool
    {
        $type = $schema->type ?? null;

        return $type === 'object'
            || (is_array($type) && in_array('object', $type, true))
            || array_intersect(array_keys(get_object_vars($schema)), ['properties', 'patternProperties', 'required', 'additionalProperties', '$ref', ...self::BRANCHES]) !== [];
    }

    /**
     * Whether a schema keeps keys it does not name: it, a component it names or one of its branches is open.
     *
     * @param  list<string>  $seen
     */
    private static function opens(object $root, mixed $schema, array $seen): bool
    {
        if (! $schema instanceof stdClass) {
            return false;
        }
        if (isset($schema->{'x-werkbuch-open'})) {
            return true;
        }

        $ref = $schema->{'$ref'} ?? null;
        if (is_string($ref) && str_starts_with($ref, '#/') && ! in_array($ref, $seen, true)
            && self::opens($root, self::pointer($root, substr($ref, 1)), [...$seen, $ref])) {
            return true;
        }

        foreach (self::BRANCHES as $keyword) {
            foreach ((array) ($schema->{$keyword} ?? []) as $sub) {
                if (self::opens($root, $sub, $seen)) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * A response or request body behind its `$ref` (`#/components/responses/…`), with its pointer.
     *
     * @return array{0: mixed, 1: string}
     */
    private static function resolve(object $root, mixed $value, string $at): array
    {
        if ($value instanceof stdClass && is_string($ref = $value->{'$ref'} ?? null) && str_starts_with($ref, '#/')) {
            return [self::pointer($root, substr($ref, 1)), substr($ref, 1)];
        }

        return [$value, $at];
    }

    private static function pointer(object $root, string $pointer): mixed
    {
        $value = $root;

        foreach (array_slice(explode('/', $pointer), 1) as $segment) {
            $segment = str_replace(['~1', '~0'], ['/', '~'], $segment);

            if ($value instanceof stdClass && property_exists($value, $segment)) {
                $value = $value->{$segment};
            } elseif (is_array($value) && array_key_exists((int) $segment, $value) && ctype_digit($segment)) {
                $value = $value[(int) $segment];
            } else {
                return null;
            }
        }

        return $value;
    }

    /**
     * @param  array<string, mixed>  $operation
     * @param  list<string>|null  $tags
     */
    private static function strict(array $operation, ?array $tags): bool
    {
        return $tags === null || array_intersect((array) ($operation['tags'] ?? []), $tags) !== [];
    }

    /**
     * Walk a schema for `emptySchemas`, following the components it names once.
     *
     * @param  array<string, mixed>  $document
     * @param  list<string>  $found
     * @param  array<string, true>  $seen
     */
    private static function loose(array $document, mixed $schema, string $at, array &$found, array &$seen): void
    {
        if (! is_array($schema) || isset($schema['x-werkbuch-open'])) {
            return;
        }

        if ($schema === []) {
            $found[] = "{$at}: empty schema";

            return;
        }

        $ref = $schema['$ref'] ?? null;
        if (is_string($ref) && str_starts_with($ref, '#/') && ! isset($seen[$ref])) {
            $seen[$ref] = true;
            self::loose($document, self::arrayPointer($document, substr($ref, 1)), $ref, $found, $seen);
        }

        $type = $schema['type'] ?? null;
        $object = $type === 'object' || (is_array($type) && in_array('object', $type, true));
        if ($object && array_intersect(array_keys($schema), ['properties', 'patternProperties', 'additionalProperties', '$ref', ...self::BRANCHES]) === []) {
            $found[] = "{$at}: object without properties";
        }

        foreach (self::MAPS as $keyword) {
            foreach (is_array($schema[$keyword] ?? null) ? $schema[$keyword] : [] as $name => $sub) {
                self::loose($document, $sub, "{$at}/{$keyword}/".self::segment((string) $name), $found, $seen);
            }
        }
        foreach ([...self::ONE, ...self::IN_PLACE] as $keyword) {
            if (array_key_exists($keyword, $schema)) {
                self::loose($document, $schema[$keyword], "{$at}/{$keyword}", $found, $seen);
            }
        }
        foreach (['prefixItems', ...self::BRANCHES] as $keyword) {
            foreach (is_array($schema[$keyword] ?? null) ? $schema[$keyword] : [] as $index => $sub) {
                self::loose($document, $sub, "{$at}/{$keyword}/{$index}", $found, $seen);
            }
        }
    }

    /**
     * A response or request body of the raw document behind its `$ref`, with its pointer (`#/…`).
     *
     * @param  array<string, mixed>  $document
     * @param  array<string, true>  $seen
     * @return array{0: mixed, 1: string}
     */
    private static function follow(array $document, mixed $value, string $at, array &$seen): array
    {
        $ref = is_array($value) ? $value['$ref'] ?? null : null;

        if (! is_string($ref) || ! str_starts_with($ref, '#/')) {
            return [$value, $at];
        }
        if (isset($seen[$ref])) {
            return [null, $ref];
        }

        $seen[$ref] = true;

        return [self::arrayPointer($document, substr($ref, 1)), $ref];
    }

    /**
     * @param  array<string, mixed>  $document
     */
    private static function arrayPointer(array $document, string $pointer): mixed
    {
        $value = $document;

        foreach (array_slice(explode('/', $pointer), 1) as $segment) {
            $segment = str_replace(['~1', '~0'], ['/', '~'], $segment);
            if (! is_array($value) || ! array_key_exists($segment, $value)) {
                return null;
            }
            $value = $value[$segment];
        }

        return $value;
    }

    private static function segment(string $key): string
    {
        return str_replace(['~', '/'], ['~0', '~1'], $key);
    }

    /**
     * A JSON pointer as the fragment of a URI.
     */
    private static function fragment(string $pointer): string
    {
        return implode('/', array_map('rawurlencode', explode('/', $pointer)));
    }

    private static function mediaType(string $header): string
    {
        return strtolower(trim(explode(';', $header)[0]));
    }

    private static function isJson(string $type): bool
    {
        return $type === 'application/json' || str_ends_with($type, '+json');
    }
}
