<?php

namespace App\Webhooks;

use App\Domain\Webhooks\Addresses;

/**
 * A webhook address after the check (spec 6.3, K5): the host as curl reads it from the URL (lower case, without
 * brackets), the port (from the URL, else 80 or 443), every address checked (IPv4 first) and the first one as `ip`.
 */
final readonly class Target
{
    /**
     * @param  list<string>  $addresses  every address checked, canonical, IPv4 first; `ip` is the first
     */
    public function __construct(
        public string $url,
        public string $host,
        public int $port,
        public string $ip,
        public array $addresses,
    ) {}

    /**
     * The entry of CURLOPT_RESOLVE that pins the name to the checked addresses: `host:port:a,b` with IPv6 addresses in
     * brackets, which curl tries in order. `null` for an address literal: curl connects to it as it is.
     */
    public function curlResolve(): ?string
    {
        if (Addresses::isIp($this->host)) {
            return null;
        }

        $addresses = array_map(fn (string $ip): string => str_contains($ip, ':') ? "[{$ip}]" : $ip, $this->addresses);

        return "{$this->host}:{$this->port}:".implode(',', $addresses);
    }
}
