<?php

namespace App\OpenApi;

use App\Domain\Automations\AutomationKey;
use Dedoc\Scramble\Extensions\OperationExtension;
use Dedoc\Scramble\Support\Generator\Operation;
use Dedoc\Scramble\Support\Generator\Parameter;
use Dedoc\Scramble\Support\Generator\Schema;
use Dedoc\Scramble\Support\Generator\Types\StringType;
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

    public function handle(Operation $operation, RouteInfo $routeInfo): void
    {
        foreach ($operation->parameters as $parameter) {
            if (! $parameter instanceof Parameter || $parameter->in !== 'path') {
                continue;
            }

            $type = new StringType;
            $parameter->description(match ($parameter->name) {
                'item' => 'The work item: its ULID (any case) or its key (`WEB-12`, any case, also with a former identifier '
                    .'of its project; a `GET` by a former key answers 301 to the current one).',
                'project' => 'The project: its ULID (any case), its identifier (`WEB`) or a former identifier.',
                'key' => 'The automation.',
                default => 'The ULID of the '.Str::snake($parameter->name, ' ').' (any case).',
            });

            match ($parameter->name) {
                'item', 'project' => null,
                'key' => $type->enum(array_column(AutomationKey::cases(), 'value')),
                default => $type->pattern(self::ULID),
            };

            $parameter->setSchema(Schema::fromType($type));
        }
    }
}
