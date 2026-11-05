<?php

namespace App\Webhooks;

use App\Domain\Webhooks\Addresses;
use Closure;

/**
 * The resolver of the system (K3): the IPv4 addresses through `gethostbynamel` (glibc with /etc/hosts, where DDEV names
 * `host.docker.internal`; CNAMEs follow the system), the IPv6 addresses through `dns_get_record` (AAAA). IPv4 first,
 * each once; an address literal is its own answer; a name without any address gives nothing.
 *
 * glibc waits 5 s for each of two attempts at a dead name server, and reads `RES_OPTIONS` only at the first lookup of a
 * process (K17, checked against a name server that never answers): limitWaiting() sets it while the app registers.
 */
final class DnsResolver implements Resolver
{
    /** At most two seconds, one attempt, for every lookup of the process (K17). */
    public const RES_OPTIONS = 'timeout:2 attempts:1';

    /**
     * Sets `RES_OPTIONS` for the process unless its environment already has it; effective only before the first
     * lookup of the process, so the app calls it while it registers.
     */
    public static function limitWaiting(): void
    {
        if (getenv('RES_OPTIONS') === false) {
            putenv('RES_OPTIONS='.self::RES_OPTIONS);
        }
    }

    private readonly Closure $v4;

    private readonly Closure $v6;

    /**
     * @param  (Closure(string): (list<string>|false))|null  $v4  the IPv4 lookup, `gethostbynamel` by default
     * @param  (Closure(string): (array<int, array<string, mixed>>|false))|null  $v6  the AAAA records, `dns_get_record` by default
     */
    public function __construct(?Closure $v4 = null, ?Closure $v6 = null)
    {
        // Docker's DNS answers no AAAA on a network without IPv6 (DDEV, CI): the tests of the merge pass lookups
        $this->v4 = $v4 ?? fn (string $host): array|false => @gethostbynamel($host);
        $this->v6 = $v6 ?? fn (string $host): array|false => @dns_get_record($host, DNS_AAAA);
    }

    public function addresses(string $host): array
    {
        if (Addresses::isIp($host)) {
            return [$host];
        }

        $v4 = ($this->v4)($host) ?: [];
        $v6 = [];
        foreach (($this->v6)($host) ?: [] as $record) {
            if (($record['type'] ?? null) === 'AAAA' && is_string($record['ipv6'] ?? null)) {
                $v6[] = $record['ipv6'];
            }
        }

        return array_values(array_unique([...$v4, ...$v6]));
    }
}
