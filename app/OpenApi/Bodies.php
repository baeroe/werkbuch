<?php

namespace App\OpenApi;

use App\Http\Api\Answer;
use App\Http\Api\Body;
use Dedoc\Scramble\Extensions\OperationExtension;
use Dedoc\Scramble\Support\Generator\Operation;
use Dedoc\Scramble\Support\Generator\Reference;
use Dedoc\Scramble\Support\Generator\RequestBodyObject;
use Dedoc\Scramble\Support\Generator\Response;
use Dedoc\Scramble\Support\Generator\Schema;
use Dedoc\Scramble\Support\RouteInfo;

/**
 * The bodies and answers the controllers write down by hand (`#[Body]`, `#[Answer]`, K15), because the actions
 * validate their input themselves and the controllers build some answers as plain objects. A body replaces whatever
 * Scramble inferred from the controller (`$request->input('code')` is no schema); an answer replaces the response of its
 * status. Runs before `ProblemResponses`, which adds the rate-limit headers to every success.
 */
final class Bodies extends OperationExtension
{
    public function handle(Operation $operation, RouteInfo $routeInfo): void
    {
        $method = $routeInfo->reflectionMethod();
        $body = ($method?->getAttributes(Body::class)[0] ?? null)?->newInstance();

        if ($body !== null) {
            $schema = $body->schema();

            // a body with nothing required may be left out (a PATCH that changes nothing); one that must name one of
            // several keys (`oneOf`) is required
            $operation->addRequestBodyObject(
                RequestBodyObject::make()
                    ->required(($schema['required'] ?? []) !== [] || isset($schema['oneOf']))
                    ->setContent($body->type, Schema::fromType(new JsonSchema($schema))),
            );
        }

        foreach ($method?->getAttributes(Answer::class) ?? [] as $attribute) {
            $answer = $attribute->newInstance();
            $response = Response::make($answer->status)
                ->setDescription($answer->description)
                ->setContent('application/json', Schema::fromType(new JsonSchema($answer->schema())));

            $operation->responses = [
                ...array_filter($operation->responses ?? [], fn (Response|Reference $existing) => (int) ($existing instanceof Reference ? $existing->resolve() : $existing)->code !== $answer->status),
                $response,
            ];
        }
    }
}
