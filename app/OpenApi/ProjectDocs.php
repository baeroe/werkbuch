<?php

namespace App\OpenApi;

use App\Actions\Projects\GetProject;
use App\Http\Controllers\Api\ProjectsController;
use Dedoc\Scramble\Extensions\OperationExtension;
use Dedoc\Scramble\Support\Generator\Operation;
use Dedoc\Scramble\Support\Generator\Parameter;
use Dedoc\Scramble\Support\Generator\Schema;
use Dedoc\Scramble\Support\RouteInfo;

/**
 * `include` of `GET /projects/{project}` (`GetProject::INCLUDES`), which no `ListSpec` describes; the list of projects
 * has it from its spec (ListParameters).
 */
final class ProjectDocs extends OperationExtension
{
    public function handle(Operation $operation, RouteInfo $routeInfo): void
    {
        if ($routeInfo->className() !== ProjectsController::class || $routeInfo->methodName() !== 'show') {
            return;
        }

        ['schema' => $schema, 'description' => $description] = self::includeParameter();
        // what Scramble guessed from the controller (`include` as a text) gives way
        $operation->parameters = array_values(array_filter($operation->parameters, fn (mixed $parameter) => ! $parameter instanceof Parameter
            || $parameter->in !== 'query' || $parameter->name !== 'include'));
        $operation->addParameters([Parameter::make('include', 'query')->setSchema(Schema::fromType(new JsonSchema($schema)))
            ->description($description)->setStyle('form')->setExplode(false)]);
    }

    /**
     * `include` of `GET /projects/{project}`: its schema and what it does (also for MCP `projects:get`).
     *
     * @return array{schema: array<string, mixed>, description: string}
     */
    public static function includeParameter(): array
    {
        return [
            'schema' => ['type' => 'array', 'items' => ['type' => 'string', 'enum' => GetProject::INCLUDES]],
            'description' => 'What to embed: `types`, the types the project switched on (catalog order, as `GET /work-item-types/{workItemType}` gives them: name, `is_epic`, the properties they ask for).',
        ];
    }
}
