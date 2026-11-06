<?php

namespace App\OpenApi;

use App\Http\Middleware\EnsureSession;
use App\Http\Middleware\EnsureTokenAbility;
use Dedoc\Scramble\Extensions\OperationExtension;
use Dedoc\Scramble\Support\Generator\Operation;
use Dedoc\Scramble\Support\Generator\SecurityRequirement;
use Dedoc\Scramble\Support\RouteInfo;

/**
 * How an operation is called (spec 6.1): with a token or the session of the web app (`security`), the ability the
 * token needs (`x-werkbuch-ability`, the rule of `EnsureTokenAbility`) and whether only the session may call it
 * (`x-werkbuch-session-only`, the routes behind `EnsureSession`, P6).
 */
final class Abilities extends OperationExtension
{
    public function handle(Operation $operation, RouteInfo $routeInfo): void
    {
        $sessionOnly = in_array(EnsureSession::class, $routeInfo->route->gatherMiddleware(), true);

        $operation->security = $sessionOnly
            ? [new SecurityRequirement(['session' => []])]
            : [new SecurityRequirement(['token' => []]), new SecurityRequirement(['session' => []])];
        $operation->setExtensionProperty('werkbuch-ability', EnsureTokenAbility::required($routeInfo->route, $routeInfo->method));

        if ($sessionOnly) {
            $operation->setExtensionProperty('werkbuch-session-only', true);
        }
    }
}
