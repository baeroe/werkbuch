<?php

namespace App\Domain\Webhooks;

/**
 * The addresses a webhook never reaches (spec 6.3, A368): private, loopback, link-local, carrier-grade NAT,
 * documentation, benchmark, multicast and reserved IPv4 networks; IPv6 loopback, unique local, link-local, multicast,
 * discard, documentation (also `3fff::/20`), site-local, Teredo, benchmarking, ORCHID and SRv6 SIDs. An IPv6 address
 * that carries an IPv4 address (v4-mapped, SIIT `::ffff:0:0:0/96`, v4-compatible, NAT64 `64:ff9b::/96`, 6to4) is
 * checked by that IPv4 address; the local NAT64 prefix `64:ff9b:1::/48` is blocked whole (it embeds the IPv4 address
 * around the u octet, K4).
 *
 * Only strict literals count as addresses (`inet_pton`): `127.1`, `0x7f.1`, `2130706433` or `[::1]` are none, though
 * curl reads some of them as 127.0.0.1 (K5), so they are blocked like anything that is no literal; so is a host with a
 * NUL byte (inet_pton would throw, T1-I1).
 */
final class Addresses
{
    /**
     * @var list<string>
     */
    public const IPV4 = [
        '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12',
        '192.0.0.0/24', '192.0.2.0/24', '192.88.99.0/24', '192.168.0.0/16', '198.18.0.0/15', '198.51.100.0/24',
        '203.0.113.0/24', '224.0.0.0/4', '240.0.0.0/4',
    ];

    /**
     * @var list<string>
     */
    public const IPV6 = [
        '::/128', '::1/128', 'fc00::/7', 'fe80::/10', 'fec0::/10', 'ff00::/8', '100::/64', '2001:db8::/32',
        '2001::/32', '64:ff9b:1::/48', '2001:2::/48', '2001:10::/28', '2001:20::/28', '3fff::/20', '5f00::/16',
    ];

    /**
     * The IPv6 networks that carry an IPv4 address, with the offset of its four bytes.
     *
     * @var array<string, int>
     */
    public const EMBEDDING = [
        '::ffff:0:0/96' => 12,
        '::ffff:0:0:0/96' => 12,
        '::/96' => 12,
        '64:ff9b::/96' => 12,
        '2002::/16' => 2,
    ];

    /**
     * Whether a webhook must not reach the address; anything that is no address literal is blocked.
     */
    public static function isBlocked(string $ip): bool
    {
        $bytes = self::bytes($ip);
        if ($bytes === false) {
            return true;
        }
        if (strlen($bytes) === 4) {
            return self::inAny($bytes, self::IPV4);
        }
        if (self::inAny($bytes, self::IPV6)) {
            return true;
        }
        foreach (self::EMBEDDING as $network => $offset) {
            if (self::in($bytes, $network)) {
                return self::inAny(substr($bytes, $offset, 4), self::IPV4);
            }
        }

        return false;
    }

    /**
     * Whether the host is a strict IPv4 or IPv6 literal (without brackets, zone or shorthand).
     */
    public static function isIp(string $host): bool
    {
        return self::bytes($host) !== false;
    }

    /**
     * The bytes of a strict literal, or false; a NUL byte makes inet_pton throw a ValueError, so it is no literal.
     */
    private static function bytes(string $host): string|false
    {
        return str_contains($host, "\0") ? false : @inet_pton($host);
    }

    /**
     * @param  list<string>  $networks
     */
    private static function inAny(string $bytes, array $networks): bool
    {
        foreach ($networks as $network) {
            if (self::in($bytes, $network)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Whether the address (bytes of `inet_pton`) lies in the network (`prefix/bits` of the same family).
     */
    private static function in(string $bytes, string $network): bool
    {
        [$prefix, $bits] = explode('/', $network);
        $net = (string) inet_pton($prefix);
        $whole = intdiv((int) $bits, 8);
        if (strncmp($bytes, $net, $whole) !== 0) {
            return false;
        }
        $rest = (int) $bits % 8;
        if ($rest === 0) {
            return true;
        }
        $mask = (0xFF << (8 - $rest)) & 0xFF;

        return (ord($bytes[$whole]) & $mask) === (ord($net[$whole]) & $mask);
    }
}
