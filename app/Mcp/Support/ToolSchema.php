<?php

namespace App\Mcp\Support;

use App\OpenApi\Components;
use App\OpenApi\ListParameters;
use App\OpenApi\PathParameters;
use App\Support\ListSpec;
use InvalidArgumentException;
use stdClass;

/**
 * The input schema of an MCP tool (`inputSchema` of `tools/list`), built from its actions (K8): `action` as an `enum`
 * with a line per action and the arguments it needs, the union of the arguments of all actions, and `input`, the body of
 * the REST twin, as an `anyOf` of the different bodies (each titled with the actions that take it). A component the
 * schemas name (`#/components/schemas/<Name>` of the OpenAPI document) stands once under `$defs` and is named
 * `#/$defs/<Name>` (JSON Schema 2020-12, the dialect of MCP and of OpenAPI 3.1); `x-werkbuch-*` and `examples` go: they
 * cost the model tokens and tell it nothing it can use.
 *
 * Tools hand their schemas raw (`<Schemas>::<method>()`, the same method `#[Body]` names); only this class reduces them.
 */
final class ToolSchema
{
    private const COMPONENT = '#/components/schemas/';

    private const DEFS = '#/$defs/';

    /** Keywords whose value is a map of schemas. */
    private const MAPS = ['properties', 'patternProperties', 'dependentSchemas', '$defs'];

    /** Keywords whose value is a list of schemas. */
    private const LISTS = ['allOf', 'anyOf', 'oneOf', 'prefixItems'];

    /** Keywords whose value is one schema. */
    private const ONE = ['items', 'additionalProperties', 'unevaluatedProperties', 'unevaluatedItems', 'contains', 'propertyNames', 'not', 'if', 'then', 'else', 'contentSchema'];

    /**
     * The input schema of a tool with these actions. A tool with one action has no argument `action`; its own required
     * arguments are required then.
     *
     * @param  list<McpAction>  $actions
     * @return array<string, mixed>
     */
    public static function input(array $actions): array
    {
        $properties = [];
        $required = $actions[0]->required ?? [];

        if (count($actions) > 1) {
            $properties['action'] = [
                'type' => 'string',
                'enum' => array_map(fn (McpAction $action): string => $action->name, $actions),
                'description' => "What to do:\n".implode("\n", array_map(self::line(...), $actions)),
            ];
            $required = ['action'];
        }

        $properties = [...$properties, ...self::arguments($actions)];

        $bodies = self::bodies($actions);
        if ($bodies !== []) {
            $properties['input'] = ['type' => 'object', 'description' => 'The JSON body of the REST twin of the action.', 'anyOf' => $bodies];
        }

        $schema = ['type' => 'object', 'properties' => $properties === [] ? new stdClass : $properties];
        if ($required !== []) {
            $schema['required'] = $required;
        }

        return self::compact($schema);
    }

    /**
     * A schema without `x-werkbuch-*` and `examples`, its components under its own `$defs`.
     *
     * @param  array<string, mixed>  $schema
     * @return array<string, mixed>
     */
    public static function compact(array $schema): array
    {
        $named = [];
        /** @var array<string, mixed> $compact */
        $compact = self::reduce($schema, $named);

        $defs = [];
        $all = Components::schemas();
        while (($name = array_key_first(array_diff_key($named, $defs))) !== null) {
            $defs[$name] = self::reduce($all[$name] ?? throw new InvalidArgumentException("No component [{$name}] to name."), $named);
        }

        if ($defs !== []) {
            ksort($defs);
            $compact['$defs'] = $defs;
        }

        return $compact;
    }

    /**
     * The arguments of a list read through its `ListSpec`, as `ListParameters` gives its query to the document: `filter`
     * an object of the filters (a list as an array, the tool sends it as comma text), `sort`, `include`, `cursor` and
     * `per_page` with the default of MCP (K8).
     *
     * @return array<string, array<string, mixed>>
     */
    public static function list(ListSpec $spec): array
    {
        $arguments = [];
        $filters = [];

        foreach (ListParameters::query($spec) as $name => ['schema' => $schema, 'description' => $description]) {
            if (preg_match('/^filter\[(.+)]$/', $name, $match) === 1) {
                $filters[$match[1]] = [...$schema, 'description' => $description];

                continue;
            }

            $arguments[$name] = [...$schema, 'description' => $description];
        }

        $arguments['per_page']['default'] = McpAction::PER_PAGE;

        return $filters === [] ? $arguments : [
            'filter' => ['type' => 'object', 'description' => 'Only rows that match every filter given; a list takes any of its values.', 'properties' => $filters],
            ...$arguments,
        ];
    }

    /**
     * The argument of a placeholder of the twin (`project`, `item`, every other one an ULID of its kind), described as
     * the OpenAPI document describes the placeholder.
     *
     * @return array<string, mixed>
     */
    public static function reference(string $placeholder): array
    {
        return PathParameters::schema($placeholder);
    }

    /**
     * The line of an action in the description of `action`: what it does and the arguments it needs.
     */
    private static function line(McpAction $action): string
    {
        $needs = $action->required === [] ? '' : ' Needs '.implode(', ', array_map(fn (string $name): string => "`{$name}`", $action->required)).'.';

        return "- `{$action->name}`: {$action->summary}{$needs}";
    }

    /**
     * The union of the arguments: one schema for a name all actions describe alike, an `anyOf` where they differ; a
     * default where every action that takes the argument has the same one.
     *
     * @param  list<McpAction>  $actions
     * @return array<string, mixed>
     */
    private static function arguments(array $actions): array
    {
        /** @var array<string, array<string, array<string, mixed>>> $schemas */
        $schemas = [];
        /** @var array<string, list<mixed>> $defaults */
        $defaults = [];

        foreach ($actions as $action) {
            $given = $action->defaultArguments();
            foreach ($action->parameters as $name => $schema) {
                $schemas[$name][(string) json_encode($schema)] = $schema;
                $defaults[$name][] = array_key_exists($name, $given) ? ['value' => $given[$name]] : null;
            }
        }

        $arguments = [];
        foreach ($schemas as $name => $distinct) {
            $argument = count($distinct) === 1 ? array_values($distinct)[0] : (self::sameReference(array_values($distinct)) ?? ['anyOf' => array_values($distinct)]);
            $same = array_values(array_unique(array_map(fn (?array $default): string => (string) json_encode($default), $defaults[$name])));
            if (count($same) === 1 && $defaults[$name][0] !== null) {
                $argument['default'] = $defaults[$name][0]['value'];
            }
            $arguments[$name] = $argument;
        }

        return $arguments;
    }

    /**
     * One schema for arguments that are ULIDs of different kinds (`ToolSchema::reference` of several placeholders, each
     * with its own description): same type and pattern, so the model needs the pattern once. `null` if they differ.
     *
     * @param  list<array<string, mixed>>  $schemas
     * @return array<string, mixed>|null
     */
    private static function sameReference(array $schemas): ?array
    {
        $shapes = array_unique(array_map(fn (array $schema): string => (string) json_encode(['type' => $schema['type'] ?? null, 'pattern' => $schema['pattern'] ?? null]), $schemas));
        $ulids = array_filter($schemas, fn (array $schema): bool => ($schema['pattern'] ?? null) === PathParameters::ULID && count($schema) === 3);

        return count($shapes) === 1 && count($ulids) === count($schemas)
            ? ['type' => 'string', 'description' => 'The ULID of the entry the action names (any case).', 'pattern' => PathParameters::ULID]
            : null;
    }

    /**
     * The different bodies of the actions, each titled with the actions that take it.
     *
     * @param  list<McpAction>  $actions
     * @return list<array<string, mixed>>
     */
    private static function bodies(array $actions): array
    {
        $bodies = [];
        $titles = [];

        foreach ($actions as $action) {
            if ($action->input !== null) {
                $key = (string) json_encode($action->input);
                $bodies[$key] = $action->input;
                $titles[$key][] = $action->name;
            }
        }

        return array_map(fn (string $key): array => ['title' => implode(', ', $titles[$key]), ...$bodies[$key]], array_keys($bodies));
    }

    /**
     * One schema reduced: its components named under `$defs` (collected in `$named`), without `x-werkbuch-*` and
     * `examples`, an empty map or schema as an object.
     *
     * @param  array<string, true>  $named
     */
    private static function reduce(mixed $schema, array &$named): mixed
    {
        if (! is_array($schema)) {
            return $schema;
        }
        if ($schema === []) {
            return new stdClass;
        }

        $reduced = [];
        foreach ($schema as $key => $value) {
            $key = (string) $key;
            if ($key === 'examples' || str_starts_with($key, 'x-werkbuch-')) {
                continue;
            }

            if ($key === '$ref' && is_string($value) && str_starts_with($value, self::COMPONENT)) {
                $reduced[$key] = self::name($value, $named);
            } elseif ((in_array($key, self::MAPS, true) || in_array($key, self::LISTS, true)) && is_array($value)) {
                // a map or list of schemas; an empty map is an object
                $subs = [];
                foreach ($value as $name => $sub) {
                    $subs[$name] = self::reduce($sub, $named);
                }
                $reduced[$key] = $subs === [] && in_array($key, self::MAPS, true) ? new stdClass : $subs;
            } else {
                $reduced[$key] = in_array($key, self::ONE, true) ? self::reduce($value, $named) : $value;
            }
        }

        return $reduced;
    }

    /**
     * @param  array<string, true>  $named
     */
    private static function name(string $ref, array &$named): string
    {
        $name = substr($ref, strlen(self::COMPONENT));
        $named[$name] = true;

        return self::DEFS.$name;
    }
}
