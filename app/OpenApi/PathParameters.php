<?php

namespace App\OpenApi;

use App\Domain\Automations\AutomationKey;
use Dedoc\Scramble\Extensions\OperationExtension;
use Dedoc\Scramble\Support\Generator\Operation;
use Dedoc\Scramble\Support\Generator\Parameter;
use Dedoc\Scramble\Support\Generator\Schema;
use Dedoc\Scramble\Support\RouteInfo;
use Illuminate\Support\Str;

/**
 * What each placeholder of a path takes (`routes/api.php`, `Route::bind`): `{item}` an ULID or a key, `{project}` an
 * ULID or an identifier, `{key}` one of the automations (K14), every other one an ULID in any case (A96: anything else
 * is 404).
 */
final class PathParameters extends OperationExtension
{
    /** An ULID in any case (Crockford's base 32, the first character at most 7). */
    public const ULID = '^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$';

    /** What `{item}` takes, without the closing bracket: REST adds its redirect, MCP has none (A408). */
    private const ITEM = 'The work item: its ULID (any case) or its key (`WEB-12`, any case, also with a former identifier of its project';

    public function handle(Operation $operation, RouteInfo $routeInfo): void
    {
        foreach ($operation->parameters as $parameter) {
            if (! $parameter instanceof Parameter || $parameter->in !== 'path') {
                continue;
            }

            $schema = self::schema($parameter->name);
            $parameter->description($parameter->name === 'item' ? self::ITEM.'; a `GET` by a former key answers 301 to the current one).' : $schema['description']);
            unset($schema['description']);
            $parameter->setSchema(Schema::fromType(new JsonSchema($schema)));
        }
    }

    /**
     * What a placeholder takes, as JSON Schema with its description: the same for the document and for the argument of
     * an MCP tool that names it (`ToolSchema::reference`); only the document adds the redirect of a former key.
     *
     * @return array{type: string, description: string, pattern?: string, enum?: list<string>}
     */
    public static function schema(string $name): array
    {
        return match ($name) {
            'item' => ['type' => 'string', 'description' => self::ITEM.').'],
            'project' => ['type' => 'string', 'description' => 'The project: its ULID (any case), its identifier (`WEB`) or a former identifier.'],
            'key' => ['type' => 'string', 'description' => 'The automation.', 'enum' => array_column(AutomationKey::cases(), 'value')],
            default => ['type' => 'string', 'description' => 'The ULID of the '.Str::snake($name, ' ').' (any case).', 'pattern' => self::ULID],
        };
    }
}
