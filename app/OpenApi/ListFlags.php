<?php

namespace App\OpenApi;

use App\Http\Controllers\Api\ProjectsController;
use App\Http\Controllers\Api\TemplatesController;
use Dedoc\Scramble\Extensions\OperationExtension;
use Dedoc\Scramble\Support\Generator\Operation;
use Dedoc\Scramble\Support\Generator\Parameter;
use Dedoc\Scramble\Support\Generator\Schema;
use Dedoc\Scramble\Support\RouteInfo;

/**
 * The flags of a list that its `ListSpec` does not hold, because they are no filter (Final-Review I1): `include_archived`
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
        $parameters = match ($routeInfo->className().'@'.$routeInfo->methodName()) {
            ProjectsController::class.'@index' => [self::flag('include_archived', 'Archived projects too (`1`); without it only the active ones.')],
            TemplatesController::class.'@index', TemplatesController::class.'@projectIndex' => [self::flag('lean', self::LEAN)],
            default => [],
        };

        $operation->addParameters($parameters);
    }

    private static function flag(string $name, string $description): Parameter
    {
        return Parameter::make($name, 'query')->setSchema(Schema::fromType(new JsonSchema(self::QUERY_FLAG)))->description($description);
    }
}
