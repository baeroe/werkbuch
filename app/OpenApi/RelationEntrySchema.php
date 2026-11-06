<?php

namespace App\OpenApi;

use App\Http\Resources\RelationEntryResource;
use Dedoc\Scramble\Extensions\TypeToSchemaExtension;
use Dedoc\Scramble\Support\Generator\Reference;
use Dedoc\Scramble\Support\Generator\Types\Type as OpenApiType;
use Dedoc\Scramble\Support\Type\ObjectType;
use Dedoc\Scramble\Support\Type\Type;

/**
 * The schema of `RelationEntryResource`, written by hand (`WorkItemSchemas::relationEntry()`): the resource wraps the
 * array ListRelations builds, not a model, so Scramble can neither read its fields (`hidden` is a boolean, `other` a
 * work item or `null`) nor infer a model for it (its warning JR001). Registered after Scramble's own extension, it takes
 * the resource over; the answers around it (`{data: …}`) stay Scramble's.
 */
final class RelationEntrySchema extends TypeToSchemaExtension
{
    public function shouldHandle(Type $type): bool
    {
        return $type instanceof ObjectType && $type->name === RelationEntryResource::class;
    }

    public function reference(ObjectType $type): Reference
    {
        return new Reference('schemas', 'RelationEntryResource', $this->components);
    }

    public function toSchema(Type $type): OpenApiType
    {
        return new JsonSchema(WorkItemSchemas::relationEntry());
    }
}
