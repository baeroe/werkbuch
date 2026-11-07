<?php

namespace App\Support;

/**
 * Where the browser opens the WebSocket of the live updates: the address of APP_URL unless the environment names
 * another one (DDEV and the CI reach Reverb on a port of its own). An empty text counts as not set.
 */
final class LiveAddress
{
    /**
     * @return array{host: ?string, port: int, scheme: 'http'|'https'}
     */
    public static function from(mixed $appUrl, mixed $host, mixed $port, mixed $scheme): array
    {
        $url = is_string($appUrl) && $appUrl !== '' ? parse_url($appUrl) : false;
        $url = is_array($url) ? $url : [];

        $fromUrl = isset($url['scheme']) ? strtolower($url['scheme']) : null;
        $chosen = is_string($scheme) ? strtolower($scheme) : null;
        $scheme = match (true) {
            $chosen === 'http' || $chosen === 'https' => $chosen,
            $fromUrl === 'http' => 'http',
            default => 'https',
        };

        $host = is_string($host) && $host !== ''
            ? $host
            : (isset($url['host']) && $url['host'] !== '' ? strtolower($url['host']) : null);

        $number = filter_var($port, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 65535]]);
        $port = $number !== false ? $number : (isset($url['port']) && $url['port'] > 0 ? $url['port'] : ($scheme === 'https' ? 443 : 80));

        return ['host' => $host, 'port' => $port, 'scheme' => $scheme];
    }
}
