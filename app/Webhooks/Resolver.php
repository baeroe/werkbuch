<?php

namespace App\Webhooks;

/**
 * Asks DNS for the addresses of a host (spec 6.3): bound to DnsResolver in the app, to Tests\Support\FakeResolver in
 * tests (`resolver([...])`).
 */
interface Resolver
{
    /**
     * The IPv4 and IPv6 addresses the host names, nothing for a name without any.
     *
     * @return list<string>
     */
    public function addresses(string $host): array;
}
