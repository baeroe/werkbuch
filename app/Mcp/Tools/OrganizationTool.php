<?php

namespace App\Mcp\Tools;

use App\Actions\Labels\GetLabel;
use App\Actions\Labels\ListLabels;
use App\Actions\Organization\GetOrganization;
use App\Actions\Properties\GetProperty;
use App\Actions\Properties\ListProperties;
use App\Actions\RelationTypes\GetRelationType;
use App\Actions\RelationTypes\ListRelationTypes;
use App\Actions\Resolutions\GetResolution;
use App\Actions\Resolutions\ListResolutions;
use App\Actions\Workflows\GetWorkflow;
use App\Actions\Workflows\ListStateUsage;
use App\Actions\Workflows\ListWorkflows;
use App\Actions\WorkItemTypes\GetWorkItemType;
use App\Actions\WorkItemTypes\ListWorkItemTypes;
use App\Http\Resources\LabelResource;
use App\Http\Resources\OrganizationResource;
use App\Http\Resources\PropertyResource;
use App\Http\Resources\RelationTypeResource;
use App\Http\Resources\ResolutionResource;
use App\Http\Resources\WorkflowResource;
use App\Http\Resources\WorkItemTypeResource;
use App\Mcp\Support\McpAction;
use App\Mcp\Support\McpArguments;
use App\Mcp\Support\McpResult;
use App\Mcp\Support\ReadTool;
use App\Mcp\Support\ToolSchema;
use App\Models\Label;
use App\Models\Property;
use App\Models\RelationType;
use App\Models\Resolution;
use App\Models\Workflow;
use App\Models\WorkItemType;
use App\Support\Actor;
use App\Support\ListSpec;
use App\Support\References;
use Closure;
use Laravel\Mcp\Server\Tools\Annotations\IsOpenWorld;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

/**
 * `organization` (spec 6.2, K14): the organization and its six catalogs as one read tool. `get` is `GET organization`;
 * every catalog has a list (`list-workflows`) and a read (`get-workflow`) of the REST twin, `state-usage` counts the
 * items per state. The writes are `manage-organization`.
 */
#[IsReadOnly]
#[IsOpenWorld(false)]
final class OrganizationTool extends ReadTool
{
    protected string $name = 'organization';

    protected string $title = 'Organization';

    protected string $description = 'Reads the organization (name, language, time zone, week start, logo) and its catalogs: workflows, work item types, '
        .'properties, labels, relation types and resolutions. Lists take `filter`, `sort`, `cursor` and `per_page`; a read takes the `id` of the entry.';

    protected function actions(): array
    {
        $actions = [
            new McpAction(
                name: 'get',
                summary: 'The organization.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new OrganizationResource(GetOrganization::run($actor))),
                twin: 'GET organization',
            ),
            new McpAction(
                name: 'state-usage',
                summary: 'The items per state of a project or of a workflow, archived ones included (`project` or `workflow`).',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::body(['data' => ListStateUsage::run($actor, $args->query(['project', 'workflow']))]),
                parameters: [
                    'project' => ['type' => 'string', 'description' => 'A project (ULID, identifier or former identifier). Either `project` or `workflow`.'],
                    'workflow' => ['type' => 'string', 'description' => 'A workflow (ULID): counts in the projects of the workflow that the account sees. Either `project` or `workflow`.'],
                ],
                twin: 'GET state-usage',
            ),
        ];

        foreach ($this->catalogs() as $catalog) {
            $actions[] = self::list($catalog);
            $actions[] = self::read($catalog);
        }

        return $actions;
    }

    /**
     * The catalogs: how a tool names one, its list and its read.
     *
     * @return list<array{name: string, plural: string, uri: string, placeholder: string, spec: ListSpec, list: Closure, get: Closure}>
     */
    private function catalogs(): array
    {
        return [
            [
                'name' => 'workflow', 'plural' => 'workflows', 'uri' => 'workflows', 'placeholder' => 'workflow', 'spec' => ListWorkflows::spec(),
                'list' => fn (Actor $actor, array $query): McpResult => McpResult::list(ListWorkflows::run($actor, $query), WorkflowResource::class),
                'get' => fn (Actor $actor, string $id): McpResult => McpResult::resource(new WorkflowResource(GetWorkflow::run($actor, References::ulid(Workflow::class, $id)))),
            ],
            [
                'name' => 'type', 'plural' => 'types', 'uri' => 'work-item-types', 'placeholder' => 'workItemType', 'spec' => ListWorkItemTypes::spec(),
                'list' => fn (Actor $actor, array $query): McpResult => McpResult::list(ListWorkItemTypes::run($actor, $query), WorkItemTypeResource::class),
                'get' => fn (Actor $actor, string $id): McpResult => McpResult::resource(new WorkItemTypeResource(GetWorkItemType::run($actor, References::ulid(WorkItemType::class, $id)))),
            ],
            [
                'name' => 'property', 'plural' => 'properties', 'uri' => 'properties', 'placeholder' => 'property', 'spec' => ListProperties::spec(),
                'list' => fn (Actor $actor, array $query): McpResult => McpResult::list(ListProperties::run($actor, $query), PropertyResource::class),
                'get' => fn (Actor $actor, string $id): McpResult => McpResult::resource(new PropertyResource(GetProperty::run($actor, References::ulid(Property::class, $id)))),
            ],
            [
                'name' => 'label', 'plural' => 'labels', 'uri' => 'labels', 'placeholder' => 'label', 'spec' => ListLabels::spec(),
                'list' => fn (Actor $actor, array $query): McpResult => McpResult::list(ListLabels::run($actor, $query), LabelResource::class),
                'get' => fn (Actor $actor, string $id): McpResult => McpResult::resource(new LabelResource(GetLabel::run($actor, References::ulid(Label::class, $id)))),
            ],
            [
                'name' => 'relation-type', 'plural' => 'relation-types', 'uri' => 'relation-types', 'placeholder' => 'relationType', 'spec' => ListRelationTypes::spec(),
                'list' => fn (Actor $actor, array $query): McpResult => McpResult::list(ListRelationTypes::run($actor, $query), RelationTypeResource::class),
                'get' => fn (Actor $actor, string $id): McpResult => McpResult::resource(new RelationTypeResource(GetRelationType::run($actor, References::ulid(RelationType::class, $id)))),
            ],
            [
                'name' => 'resolution', 'plural' => 'resolutions', 'uri' => 'resolutions', 'placeholder' => 'resolution', 'spec' => ListResolutions::spec(),
                'list' => fn (Actor $actor, array $query): McpResult => McpResult::list(ListResolutions::run($actor, $query), ResolutionResource::class),
                'get' => fn (Actor $actor, string $id): McpResult => McpResult::resource(new ResolutionResource(GetResolution::run($actor, References::ulid(Resolution::class, $id)))),
            ],
        ];
    }

    /**
     * @param  array{name: string, plural: string, uri: string, placeholder: string, spec: ListSpec, list: Closure, get: Closure}  $catalog
     */
    private static function list(array $catalog): McpAction
    {
        $parameters = ToolSchema::list($catalog['spec']);

        return new McpAction(
            name: 'list-'.$catalog['plural'],
            summary: "The {$catalog['plural']}.",
            run: fn (Actor $actor, McpArguments $args): McpResult => ($catalog['list'])($actor, $args->query(array_keys($parameters))),
            parameters: $parameters,
            twin: 'GET '.$catalog['uri'],
        );
    }

    /**
     * @param  array{name: string, plural: string, uri: string, placeholder: string, spec: ListSpec, list: Closure, get: Closure}  $catalog
     */
    private static function read(array $catalog): McpAction
    {
        return new McpAction(
            name: 'get-'.$catalog['name'],
            summary: 'One '.ManageOrganizationTool::noun($catalog).'.',
            run: fn (Actor $actor, McpArguments $args): McpResult => ($catalog['get'])($actor, $args->reference('id')),
            parameters: ['id' => ToolSchema::reference($catalog['placeholder'])],
            required: ['id'],
            twin: "GET {$catalog['uri']}/{{$catalog['placeholder']}}",
            path: [$catalog['placeholder'] => 'id'],
        );
    }
}
