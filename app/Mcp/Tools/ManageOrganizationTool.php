<?php

namespace App\Mcp\Tools;

use App\Actions\Labels\DeleteLabel;
use App\Actions\Labels\SaveLabel;
use App\Actions\Organization\UpdateOrganization;
use App\Actions\Properties\DeleteProperty;
use App\Actions\Properties\SaveProperty;
use App\Actions\RelationTypes\DeleteRelationType;
use App\Actions\RelationTypes\SaveRelationType;
use App\Actions\Resolutions\DeleteResolution;
use App\Actions\Resolutions\SaveResolution;
use App\Actions\Workflows\DeleteWorkflow;
use App\Actions\Workflows\SaveWorkflow;
use App\Actions\WorkItemTypes\DeleteWorkItemType;
use App\Actions\WorkItemTypes\SaveWorkItemType;
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
use App\Mcp\Support\ToolSchema;
use App\Mcp\Support\WriteTool;
use App\Models\Label;
use App\Models\Property;
use App\Models\RelationType;
use App\Models\Resolution;
use App\Models\Workflow;
use App\Models\WorkItemType;
use App\OpenApi\AccountSchemas;
use App\OpenApi\CatalogSchemas;
use App\Support\Actor;
use App\Support\References;
use Closure;
use Laravel\Mcp\Server\Tools\Annotations\IsDestructive;
use Laravel\Mcp\Server\Tools\Annotations\IsOpenWorld;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

/**
 * `manage-organization` (spec 6.2, K14): the writes of the organization and its six catalogs, the pair of
 * `organization`. `update` changes the organization (`PATCH organization`); every catalog has `create-…`, `update-…`
 * (`PUT`, which replaces the entry as a whole) and `delete-…` of the REST twin. Only org admins change a catalog; the
 * action says so with 403.
 */
#[IsDestructive]
#[IsReadOnly(false)]
#[IsOpenWorld(false)]
final class ManageOrganizationTool extends WriteTool
{
    protected string $name = 'manage-organization';

    protected string $title = 'Manage organization';

    protected string $description = 'Changes the organization and its catalogs (org admins only): `create-`, `update-` (replaces the entry as a whole) '
        .'and `delete-` of a workflow, type, property, label, relation type or resolution.';

    protected function actions(): array
    {
        $actions = [
            new McpAction(
                name: 'update',
                summary: 'Changes the organization; only the keys named change.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new OrganizationResource(UpdateOrganization::run($actor, $args->input()))),
                input: AccountSchemas::organization(),
                required: ['input'],
                twin: 'PATCH organization',
            ),
        ];

        foreach ($this->catalogs() as $catalog) {
            $actions[] = self::write($catalog, 'create');
            $actions[] = self::write($catalog, 'update');
            $actions[] = self::delete($catalog);
        }

        return $actions;
    }

    /**
     * The catalogs: how a tool names one, its body and what saving and deleting run.
     *
     * @return list<array{name: string, uri: string, placeholder: string, body: array<string, mixed>, save: Closure, delete: Closure}>
     */
    private function catalogs(): array
    {
        return [
            [
                'name' => 'workflow', 'uri' => 'workflows', 'placeholder' => 'workflow', 'body' => CatalogSchemas::workflow(),
                'save' => fn (Actor $actor, ?string $id, array $input): McpResult => McpResult::resource(new WorkflowResource(SaveWorkflow::run($actor, $id === null ? null : References::ulid(Workflow::class, $id), $input))),
                'delete' => function (Actor $actor, string $id): McpResult {
                    DeleteWorkflow::run($actor, References::ulid(Workflow::class, $id));

                    return McpResult::done();
                },
            ],
            [
                'name' => 'type', 'uri' => 'work-item-types', 'placeholder' => 'workItemType', 'body' => CatalogSchemas::workItemType(),
                'save' => fn (Actor $actor, ?string $id, array $input): McpResult => McpResult::resource(new WorkItemTypeResource(SaveWorkItemType::run($actor, $id === null ? null : References::ulid(WorkItemType::class, $id), $input))),
                'delete' => fn (Actor $actor, string $id): McpResult => McpResult::body(DeleteWorkItemType::run($actor, References::ulid(WorkItemType::class, $id))),
            ],
            [
                'name' => 'property', 'uri' => 'properties', 'placeholder' => 'property', 'body' => CatalogSchemas::property(),
                'save' => fn (Actor $actor, ?string $id, array $input): McpResult => McpResult::resource(new PropertyResource(SaveProperty::run($actor, $id === null ? null : References::ulid(Property::class, $id), $input))),
                'delete' => fn (Actor $actor, string $id): McpResult => McpResult::body(['affected_items' => DeleteProperty::run($actor, References::ulid(Property::class, $id))]),
            ],
            [
                'name' => 'label', 'uri' => 'labels', 'placeholder' => 'label', 'body' => CatalogSchemas::label(),
                'save' => fn (Actor $actor, ?string $id, array $input): McpResult => McpResult::resource(new LabelResource(SaveLabel::run($actor, $id === null ? null : References::ulid(Label::class, $id), $input))),
                'delete' => fn (Actor $actor, string $id): McpResult => McpResult::body(['affected_items' => DeleteLabel::run($actor, References::ulid(Label::class, $id))]),
            ],
            [
                'name' => 'relation-type', 'uri' => 'relation-types', 'placeholder' => 'relationType', 'body' => CatalogSchemas::relationType(),
                'save' => fn (Actor $actor, ?string $id, array $input): McpResult => McpResult::resource(new RelationTypeResource(SaveRelationType::run($actor, $id === null ? null : References::ulid(RelationType::class, $id), $input))),
                'delete' => fn (Actor $actor, string $id): McpResult => McpResult::body(['affected_relations' => DeleteRelationType::run($actor, References::ulid(RelationType::class, $id))]),
            ],
            [
                'name' => 'resolution', 'uri' => 'resolutions', 'placeholder' => 'resolution', 'body' => CatalogSchemas::resolution(),
                'save' => fn (Actor $actor, ?string $id, array $input): McpResult => McpResult::resource(new ResolutionResource(SaveResolution::run($actor, $id === null ? null : References::ulid(Resolution::class, $id), $input))),
                'delete' => fn (Actor $actor, string $id): McpResult => McpResult::body(DeleteResolution::run($actor, References::ulid(Resolution::class, $id))),
            ],
        ];
    }

    /**
     * @param  array{name: string, uri: string, placeholder: string, body: array<string, mixed>, save: Closure, delete: Closure}  $catalog
     */
    private static function write(array $catalog, string $verb): McpAction
    {
        $update = $verb === 'update';

        return new McpAction(
            name: "{$verb}-{$catalog['name']}",
            summary: ($update ? 'Replaces a ' : 'Creates a ').self::noun($catalog).'.',
            run: fn (Actor $actor, McpArguments $args): McpResult => ($catalog['save'])($actor, $update ? $args->reference('id') : null, $args->input()),
            parameters: $update ? ['id' => ToolSchema::reference($catalog['placeholder'])] : [],
            input: $catalog['body'],
            required: $update ? ['id', 'input'] : ['input'],
            twin: $update ? "PUT {$catalog['uri']}/{{$catalog['placeholder']}}" : "POST {$catalog['uri']}",
            path: $update ? [$catalog['placeholder'] => 'id'] : [],
        );
    }

    /**
     * @param  array{name: string, uri: string, placeholder: string, body: array<string, mixed>, save: Closure, delete: Closure}  $catalog
     */
    private static function delete(array $catalog): McpAction
    {
        return new McpAction(
            name: 'delete-'.$catalog['name'],
            summary: 'Deletes a '.self::noun($catalog).'.',
            run: fn (Actor $actor, McpArguments $args): McpResult => ($catalog['delete'])($actor, $args->reference('id')),
            parameters: ['id' => ToolSchema::reference($catalog['placeholder'])],
            required: ['id'],
            twin: "DELETE {$catalog['uri']}/{{$catalog['placeholder']}}",
            path: [$catalog['placeholder'] => 'id'],
        );
    }

    /**
     * How the summaries call a catalog entry: `relation type`, `work item type`.
     *
     * @param  array{name: string, ...}  $catalog
     */
    private static function noun(array $catalog): string
    {
        return $catalog['name'] === 'type' ? 'work item type' : str_replace('-', ' ', $catalog['name']);
    }
}
