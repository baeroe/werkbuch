<?php

namespace App\OpenApi;

use App\Http\Api\ApiList;
use Dedoc\Scramble\Infer\Extensions\Event\StaticMethodCallEvent;
use Dedoc\Scramble\Infer\Extensions\StaticMethodReturnTypeExtension;
use Dedoc\Scramble\Support\Type\Generic;
use Dedoc\Scramble\Support\Type\GenericClassStringType;
use Dedoc\Scramble\Support\Type\ObjectType;
use Dedoc\Scramble\Support\Type\Type;
use Illuminate\Http\JsonResponse;

/**
 * What `ApiList::respond($result, X::class)` answers, for Scramble: a `JsonResponse<X>` (one template, the resource;
 * Scramble's own `JsonResponse<data, status, headers>` has three), which `ApiListSchema` turns into `{data, links,
 * meta}`. A `JsonResponse`, so the declared return type of the controller method (`: JsonResponse`) takes it.
 * Without a resource Scramble can read, it infers on its own.
 */
final class ApiListReturnType implements StaticMethodReturnTypeExtension
{
    public function shouldHandle(string $name): bool
    {
        return $name === ApiList::class;
    }

    public function getStaticMethodReturnType(StaticMethodCallEvent $event): ?Type
    {
        $resource = $event->getArg('resource', 1);

        return $event->getName() === 'respond' && $resource instanceof GenericClassStringType && $resource->type instanceof ObjectType
            ? new Generic(JsonResponse::class, [new ObjectType($resource->type->name)])
            : null;
    }
}
