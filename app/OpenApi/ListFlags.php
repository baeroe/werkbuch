<?php

namespace App\OpenApi;

use App\Http\Api\ListOf;
use Dedoc\Scramble\Extensions\OperationExtension;
use Dedoc\Scramble\Support\Generator\Operation;
use Dedoc\Scramble\Support\Generator\Parameter;
use Dedoc\Scramble\Support\Generator\Schema;
use Dedoc\Scramble\Support\RouteInfo;

/**
 * The flags of a list that are no filter (Final-Review I1), read from its `ListSpec` (`flags`, T14): `include_archived`
 * of `GET /projects` (`ListProjects`) and `lean` of `GET /templates` and `GET /projects/{project}/templates`
 * (`ListTemplates`). A flag is `1` or `0`, as Laravel's `boolean` reads it in a query string.
 */
final class ListFlags extends OperationExtension
{
    public const QUERY_FLAG = ['type' => 'integer', 'enum' => [1, 0]];

    /** The flag `lean` of the template lists. */
    public const LEAN = 'Leave the texts out (`1`): no `description`, `description_json` and `values_markdown` in `payload`, '
        .'the rest as usual (the list of a command palette).';

    public function handle(Operation $operation, RouteInfo $routeInfo): void
    {
        $listOf = ($routeInfo->reflectionMethod()?->getAttributes(ListOf::class)[0] ?? null)?->newInstance();
        $flags = $listOf?->spec()->flags ?? [];

        $operation->addParameters(array_map(fn (string $name, string $description) => self::flag($name, $description), array_keys($flags), $flags));
    }

    private static function flag(string $name, string $description): Parameter
    {
        return Parameter::make($name, 'query')->setSchema(Schema::fromType(new JsonSchema(self::QUERY_FLAG)))->description($description);
    }
}
