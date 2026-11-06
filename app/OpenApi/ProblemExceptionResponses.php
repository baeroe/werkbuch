<?php

namespace App\OpenApi;

use Dedoc\Scramble\Extensions\ExceptionToResponseExtension;
use Dedoc\Scramble\Support\Generator\Reference;
use Dedoc\Scramble\Support\Generator\Response;
use Dedoc\Scramble\Support\Type\ObjectType;
use Dedoc\Scramble\Support\Type\Type;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Validation\ValidationException;

/**
 * The exceptions Scramble infers for a route (`auth:*`, a model in the path, a FormRequest) as the problems the server
 * answers with (`App\Http\Api\ProblemResponse`), never as Laravel's `{message}`: registered after Scramble's own
 * extensions, it wins over them (K1). Whatever it leaves (an HTTP exception with a status it cannot read),
 * `ProblemResponses` replaces by its status.
 */
final class ProblemExceptionResponses extends ExceptionToResponseExtension
{
    /** The status Laravel's rendering gives each exception under /api (`ProblemResponse::from`). */
    private const STATUSES = [
        ValidationException::class => 422,
        AuthenticationException::class => 401,
        AuthorizationException::class => 403,
        ModelNotFoundException::class => 404,
    ];

    public function shouldHandle(Type $type): bool
    {
        return self::statusOf($type) !== null;
    }

    public function toResponse(Type $type): ?Response
    {
        $status = self::statusOf($type);

        return $status === null ? null : ProblemResponses::response($this->components, $status);
    }

    public function reference(ObjectType $type): ?Reference
    {
        $status = self::statusOf($type);

        return $status === null ? null : new Reference('responses', 'Problem'.$status, $this->components);
    }

    private static function statusOf(Type $type): ?int
    {
        if (! $type instanceof ObjectType) {
            return null;
        }

        foreach (self::STATUSES as $class => $status) {
            if ($type->isInstanceOf($class)) {
                return $status;
            }
        }

        return null;
    }
}
