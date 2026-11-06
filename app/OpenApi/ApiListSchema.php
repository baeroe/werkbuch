<?php

namespace App\OpenApi;

use Dedoc\Scramble\Extensions\TypeToSchemaExtension;
use Dedoc\Scramble\Support\Generator\Reference;
use Dedoc\Scramble\Support\Generator\Response;
use Dedoc\Scramble\Support\Generator\Schema;
use Dedoc\Scramble\Support\Generator\Types\ArrayType;
use Dedoc\Scramble\Support\Generator\Types\ObjectType as ObjectSchema;
use Dedoc\Scramble\Support\Type\Generic;
use Dedoc\Scramble\Support\Type\ObjectType;
use Dedoc\Scramble\Support\Type\Type;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The answer of a list (`JsonResponse<X>` from `ApiListReturnType`, X a resource): 200 with `{data: list<X>, links: ListLinks, meta:
 * ListMeta}`, all three required; `ListMeta` carries the number of all matches (`Components`).
 */
final class ApiListSchema extends TypeToSchemaExtension
{
    public function shouldHandle(Type $type): bool
    {
        return $type instanceof Generic && $type->isInstanceOf(JsonResponse::class) && count($type->templateTypes) === 1
            && $type->templateTypes[0] instanceof ObjectType && $type->templateTypes[0]->isInstanceOf(JsonResource::class);
    }

    /**
     * @param  Generic  $type
     */
    public function toSchema(Type $type): ObjectSchema
    {
        return (new ObjectSchema)
            ->addProperty('data', (new ArrayType)->setItems($this->openApiTransformer->transform($type->templateTypes[0])))
            ->addProperty('links', new Reference('schemas', 'ListLinks', $this->components))
            ->addProperty('meta', new Reference('schemas', 'ListMeta', $this->components))
            ->setRequired(['data', 'links', 'meta']);
    }

    /**
     * @param  Generic  $type
     */
    public function toResponse(Type $type): Response
    {
        /** @var ObjectType $resource */
        $resource = $type->templateTypes[0];

        return Response::make(200)
            ->setContent('application/json', Schema::fromType($this->toSchema($type)))
            ->setDescription('A page of `'.class_basename($resource->name).'`.');
    }
}
