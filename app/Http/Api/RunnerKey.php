<?php

namespace App\Http\Api;

use App\Models\Runner;
use Illuminate\Http\Request;

/**
 * The runner of a request of the runner protocol (spec 6.1, A472): its bearer token, looked up once per request (the
 * throttle runs before the authentication and asks as well). The throttle `runner` counts per runner, everything else
 * (an unknown or revoked token, none) per address.
 */
final class RunnerKey
{
    private const FOUND = 'werkbuch.runner';

    public static function runner(Request $request): ?Runner
    {
        if (! $request->attributes->has(self::FOUND)) {
            $request->attributes->set(self::FOUND, Runner::findByToken($request->bearerToken()));
        }

        $runner = $request->attributes->get(self::FOUND);

        return $runner instanceof Runner ? $runner : null;
    }

    public static function for(Request $request): string
    {
        $runner = self::runner($request);

        return $runner === null ? RateKey::IP.$request->ip() : 'runner:'.$runner->id;
    }
}
