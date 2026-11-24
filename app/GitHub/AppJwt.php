<?php

namespace App\GitHub;

use App\Models\GitHubApp;

/**
 * The JSON web token the app signs itself in to GitHub with (RS256 over its private key, `iss` the app ID): issued 60 s
 * in the past against a clock that runs ahead, valid nine minutes (GitHub takes at most ten). No library: neither
 * firebase/php-jwt nor lcobucci/jwt is in the lock file, and this is the one token werkbuch signs (A510).
 */
final class AppJwt
{
    public static function for(GitHubApp $app, int $now): string
    {
        $header = self::encode((string) json_encode(['alg' => 'RS256', 'typ' => 'JWT']));
        $payload = self::encode((string) json_encode(['iat' => $now - 60, 'exp' => $now + 540, 'iss' => (string) $app->app_id]));

        $key = openssl_pkey_get_private($app->private_key);
        if ($key === false || ! openssl_sign($header.'.'.$payload, $signature, $key, OPENSSL_ALGO_SHA256)) {
            throw new GitHubUnavailable(GitHubUnavailable::UNREACHABLE, 'The private key of the GitHub app cannot sign.');
        }

        return $header.'.'.$payload.'.'.self::encode($signature);
    }

    private static function encode(string $bytes): string
    {
        return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
    }
}
