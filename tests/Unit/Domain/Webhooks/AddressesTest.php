<?php

use App\Domain\Webhooks\Addresses;

it('blocks every address of the blocked IPv4 networks', function (string $ip) {
    expect(Addresses::isBlocked($ip))->toBeTrue();
})->with([
    // first and last address of each network
    '0.0.0.0/8' => ['0.0.0.0'], '0.0.0.0/8 last' => ['0.255.255.255'],
    '10/8' => ['10.0.0.0'], '10/8 last' => ['10.255.255.255'],
    '100.64/10' => ['100.64.0.0'], '100.64/10 last' => ['100.127.255.255'],
    '127/8' => ['127.0.0.1'], '127/8 last' => ['127.255.255.255'],
    '169.254/16 (metadata)' => ['169.254.169.254'], '169.254/16 last' => ['169.254.255.255'],
    '172.16/12' => ['172.16.0.0'], '172.16/12 last' => ['172.31.255.255'],
    '192.0.0/24' => ['192.0.0.8'],
    '192.0.2/24' => ['192.0.2.1'],
    '192.88.99/24 (6to4 relay, K4)' => ['192.88.99.1'],
    '192.168/16' => ['192.168.0.1'], '192.168/16 last' => ['192.168.255.255'],
    '198.18/15' => ['198.18.0.0'], '198.18/15 last' => ['198.19.255.255'],
    '198.51.100/24' => ['198.51.100.7'],
    '203.0.113/24' => ['203.0.113.9'],
    '224/4' => ['224.0.0.1'], '224/4 last' => ['239.255.255.255'],
    '240/4' => ['240.0.0.1'], '240/4 last (broadcast)' => ['255.255.255.255'],
]);

it('lets the neighbours of the blocked IPv4 networks through', function (string $ip) {
    expect(Addresses::isBlocked($ip))->toBeFalse();
})->with([
    'before 10/8' => ['9.255.255.255'], 'after 10/8' => ['11.0.0.0'],
    'after 0.0.0.0/8' => ['1.0.0.0'],
    'before 100.64/10' => ['100.63.255.255'], 'after 100.64/10' => ['100.128.0.0'],
    'before 127/8' => ['126.255.255.255'], 'after 127/8' => ['128.0.0.0'],
    'before 169.254/16' => ['169.253.255.255'], 'after 169.254/16' => ['169.255.0.0'],
    'before 172.16/12' => ['172.15.255.255'], 'after 172.16/12' => ['172.32.0.0'],
    'before 192.0.0/24' => ['191.255.255.255'], 'after 192.0.2/24' => ['192.0.3.0'], 'between 192.0.0 and 192.0.2' => ['192.0.1.0'],
    'before 192.88.99/24' => ['192.88.98.255'], 'after 192.88.99/24' => ['192.88.100.0'],
    'before 192.168/16' => ['192.167.255.255'], 'after 192.168/16' => ['192.169.0.0'],
    'before 198.18/15' => ['198.17.255.255'], 'after 198.18/15' => ['198.20.0.0'],
    'before 198.51.100/24' => ['198.51.99.255'], 'after 198.51.100/24' => ['198.51.101.0'],
    'before 203.0.113/24' => ['203.0.112.255'], 'after 203.0.113/24' => ['203.0.114.0'],
    'before 224/4' => ['223.255.255.255'],
    'a public resolver' => ['8.8.8.8'],
    'another public resolver' => ['1.1.1.1'],
]);

it('blocks every address of the blocked IPv6 networks', function (string $ip) {
    expect(Addresses::isBlocked($ip))->toBeTrue();
})->with([
    '::/128' => ['::'],
    '::1/128' => ['::1'],
    'fc00::/7' => ['fc00::1'], 'fc00::/7 last' => ['fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff'],
    'fc00::/7 (metadata of EC2)' => ['fd00:ec2::254'],
    'fe80::/10' => ['fe80::1'], 'fe80::/10 last' => ['febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff'],
    'fec0::/10' => ['fec0::1'], 'fec0::/10 last' => ['feff:ffff:ffff:ffff:ffff:ffff:ffff:ffff'],
    'ff00::/8' => ['ff02::1'], 'ff00::/8 last' => ['ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff'],
    '100::/64' => ['100::1'], '100::/64 last' => ['100::ffff:ffff:ffff:ffff'],
    '2001:db8::/32' => ['2001:db8::1'], '2001:db8::/32 last' => ['2001:db8:ffff:ffff:ffff:ffff:ffff:ffff'],
    '2001::/32 (Teredo, K4)' => ['2001:0:4136:e378::1'], '2001::/32 last' => ['2001:0:ffff:ffff:ffff:ffff:ffff:ffff'],
    '64:ff9b:1::/48 with a private IPv4 (K4)' => ['64:ff9b:1::a9fe:a9fe'],
    '64:ff9b:1::/48 with a public IPv4 (K4)' => ['64:ff9b:1::808:808'],
    '64:ff9b:1::/48 last' => ['64:ff9b:1:ffff:ffff:ffff:ffff:ffff'],
    '2001:2::/48 (benchmarking)' => ['2001:2::1'], '2001:2::/48 last' => ['2001:2:0:ffff:ffff:ffff:ffff:ffff'],
    '2001:10::/28 (ORCHID)' => ['2001:10::1'], '2001:10::/28 last' => ['2001:1f:ffff:ffff:ffff:ffff:ffff:ffff'],
    '2001:20::/28 (ORCHIDv2)' => ['2001:20::1'], '2001:20::/28 last' => ['2001:2f:ffff:ffff:ffff:ffff:ffff:ffff'],
    '3fff::/20 (documentation)' => ['3fff::1'], '3fff::/20 last' => ['3fff:fff:ffff:ffff:ffff:ffff:ffff:ffff'],
    '5f00::/16 (SRv6 SIDs)' => ['5f00::1'], '5f00::/16 last' => ['5f00:ffff:ffff:ffff:ffff:ffff:ffff:ffff'],
]);

it('lets the neighbours of the blocked IPv6 networks through', function (string $ip) {
    expect(Addresses::isBlocked($ip))->toBeFalse();
})->with([
    'before fc00::/7' => ['fbff:ffff:ffff:ffff:ffff:ffff:ffff:ffff'],
    'between fc00::/7 and fe80::/10' => ['fe00::1'],
    'after 100::/64' => ['100:0:0:1::1'],
    'before 2001:db8::/32' => ['2001:db7:ffff:ffff:ffff:ffff:ffff:ffff'], 'after 2001:db8::/32' => ['2001:db9::1'],
    'after 2001::/32' => ['2001:1::1'],
    'after 64:ff9b:1::/48' => ['64:ff9b:2::1'],
    'after 2001:2::/48' => ['2001:2:1::1'], 'before 2001:10::/28' => ['2001:f:ffff:ffff:ffff:ffff:ffff:ffff'],
    'after 2001:20::/28' => ['2001:30::1'],
    'before 3fff::/20' => ['3ffe:ffff:ffff:ffff:ffff:ffff:ffff:ffff'], 'after 3fff::/20' => ['3fff:1000::1'],
    'before 5f00::/16' => ['5eff:ffff:ffff:ffff:ffff:ffff:ffff:ffff'], 'after 5f00::/16' => ['5f01::1'],
    'a public host' => ['2606:4700::1111'],
    'a public resolver' => ['2001:4860:4860::8888'],
]);

it('checks the IPv4 address an IPv6 address carries', function (string $ip, bool $blocked) {
    expect(Addresses::isBlocked($ip))->toBe($blocked);
})->with([
    'v4-mapped loopback' => ['::ffff:127.0.0.1', true],
    'v4-mapped loopback in hex' => ['::ffff:7f00:1', true],
    'v4-mapped in capitals' => ['::FFFF:7F00:1', true],
    'v4-mapped metadata' => ['::ffff:169.254.169.254', true],
    'v4-mapped public' => ['::ffff:8.8.8.8', false],
    'v4-compatible loopback' => ['::127.0.0.1', true],
    'v4-compatible private' => ['::10.1.2.3', true],
    'v4-compatible public' => ['::8.8.8.8', false],
    'NAT64 metadata' => ['64:ff9b::a9fe:a9fe', true],
    'NAT64 loopback' => ['64:ff9b::7f00:1', true],
    'NAT64 public' => ['64:ff9b::808:808', false],
    '6to4 metadata' => ['2002:a9fe:a9fe::1', true],
    '6to4 loopback' => ['2002:7f00:1::', true],
    '6to4 private' => ['2002:c0a8:101::1', true],
    '6to4 public' => ['2002:0808:0808::1', false],
    'SIIT loopback' => ['::ffff:0:7f00:1', true],
    'SIIT metadata' => ['::ffff:0:169.254.169.254', true],
    'SIIT public' => ['::ffff:0:808:808', false],
]);

it('blocks what is no address literal', function (string $host) {
    expect(Addresses::isIp($host))->toBeFalse()
        ->and(Addresses::isBlocked($host))->toBeTrue();
})->with([
    'a host name' => ['example.com'],
    'nothing' => [''],
    // curl reads these as 127.0.0.1 (K5): they are no literal, so a name check never lets them pass
    'a short dotted form' => ['127.1'],
    'a hexadecimal part' => ['0x7f.1'],
    'a decimal number' => ['2130706433'],
    'an octal part' => ['0177.0.0.1'],
    'a leading zero' => ['010.0.0.1'],
    'a trailing dot' => ['8.8.8.8.'],
    'a space' => [' 8.8.8.8'],
    'brackets' => ['[::1]'],
    'a zone' => ['fe80::1%eth0'],
    'a dangling colon' => ['::1:'],
    // inet_pton throws a ValueError for a NUL byte (T1-I1)
    'a NUL byte after an address' => ["8.8.8.8\0x"],
    'a NUL byte alone' => ["\0"],
]);

it('knows an address literal', function (string $host) {
    expect(Addresses::isIp($host))->toBeTrue();
})->with([
    'IPv4' => ['8.8.8.8'],
    'IPv6' => ['2606:4700::1111'],
    'IPv6 loopback' => ['::1'],
    'IPv6 in capitals' => ['::FFFF:127.0.0.1'],
]);

it('spares only the private networks with webhooks_allow_private (A378)', function (string $ip, bool $blocked) {
    expect(Addresses::isBlocked($ip, true))->toBe($blocked)
        ->and(Addresses::isBlocked($ip))->toBeTrue();
})->with([
    // spared: private, loopback, carrier-grade NAT, unique local
    '10/8' => ['10.1.2.3', false], '10/8 last' => ['10.255.255.255', false],
    '172.16/12' => ['172.16.0.1', false], '172.16/12 last' => ['172.31.255.255', false],
    '192.168/16' => ['192.168.5.2', false],
    '127/8' => ['127.0.0.1', false], '127/8 last' => ['127.255.255.255', false],
    '100.64/10' => ['100.64.0.1', false], '100.64/10 last' => ['100.127.255.255', false],
    '::1' => ['::1', false],
    'fc00::/7' => ['fc00::1', false], 'fd00::1' => ['fd00::1', false],
    'v4-mapped private' => ['::ffff:10.0.0.1', false],
    'v4-mapped loopback' => ['::ffff:127.0.0.1', false],
    // kept: metadata, the whole link-local networks, this network, multicast, reserved, documentation, benchmark
    'Alibaba metadata in 100.64/10' => ['100.100.100.200', true],
    'AWS metadata over IPv6 in fc00::/7' => ['fd00:ec2::254', true],
    'metadata' => ['169.254.169.254', true], '169.254/16' => ['169.254.0.1', true], '169.254/16 last' => ['169.254.255.255', true],
    'fe80::/10' => ['fe80::1', true],
    '0.0.0.0' => ['0.0.0.0', true], '0/8 last' => ['0.255.255.255', true],
    '::' => ['::', true],
    '224/4' => ['224.0.0.1', true], 'ff00::/8' => ['ff02::1', true],
    '240/4' => ['240.0.0.1', true], 'broadcast' => ['255.255.255.255', true],
    '192.0.0/24' => ['192.0.0.8', true], '192.0.2/24' => ['192.0.2.1', true], '198.18/15' => ['198.18.0.1', true],
    '2001:db8::/32' => ['2001:db8::1', true], 'Teredo' => ['2001::1', true], 'fec0::/10' => ['fec0::1', true],
    'local NAT64' => ['64:ff9b:1::a00:1', true],
    'v4-mapped metadata' => ['::ffff:169.254.169.254', true],
    'NAT64 metadata' => ['64:ff9b::a9fe:a9fe', true],
    '6to4 metadata' => ['2002:a9fe:a9fe::', true],
    'v4-mapped this network' => ['::ffff:0.0.0.0', true],
]);

it('blocks what is no address literal with webhooks_allow_private', function () {
    expect(Addresses::isBlocked('127.1', true))->toBeTrue()
        ->and(Addresses::isBlocked('localhost', true))->toBeTrue();
});

it('never reads an IPv4 address in an IPv6 network of PRIVATE', function () {
    // 252.0.0.1 starts with the bits of fc00::/7, but lies in 240/4
    expect(Addresses::isBlocked('252.0.0.1', true))->toBeTrue()
        ->and(Addresses::isBlocked('253.255.0.1', true))->toBeTrue();
});
