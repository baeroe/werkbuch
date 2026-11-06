<?php

use App\Webhooks\DnsResolver;
use App\Webhooks\SafeTarget;
use App\Webhooks\Target;
use App\Webhooks\UnsafeTarget;

beforeEach(fn () => config(['werkbuch.webhooks_allow_private' => false]));

$refusal = function (string $url): UnsafeTarget {
    try {
        SafeTarget::check($url);
    } catch (UnsafeTarget $refused) {
        return $refused;
    }

    throw new RuntimeException("{$url} was not refused");
};

it('pins the first checked address', function () {
    resolver(['receiver.example.com' => ['93.184.216.34', '93.184.216.35']]);

    $target = SafeTarget::check('https://receiver.example.com/hook?x=1');

    expect($target)->toBeInstanceOf(Target::class)
        ->and($target->url)->toBe('https://receiver.example.com/hook?x=1')
        ->and($target->host)->toBe('receiver.example.com')
        ->and($target->port)->toBe(443)
        ->and($target->ip)->toBe('93.184.216.34')
        ->and($target->addresses)->toBe(['93.184.216.34', '93.184.216.35'])
        ->and($target->curlResolve())->toBe('receiver.example.com:443:93.184.216.34,93.184.216.35');
});

it('lists every checked address, IPv4 first', function () {
    resolver(['receiver.example.com' => ['2606:4700:0:0:0:0:0:1111', '93.184.216.34', '2606:4700::1111', '93.184.216.34']]);

    $target = SafeTarget::check('http://receiver.example.com/hook');

    expect($target->addresses)->toBe(['93.184.216.34', '2606:4700::1111'])
        ->and($target->ip)->toBe('93.184.216.34')
        ->and($target->port)->toBe(80)
        ->and($target->curlResolve())->toBe('receiver.example.com:80:93.184.216.34,[2606:4700::1111]');
});

it('refuses a name that points at a private address', function (string $address) use ($refusal) {
    resolver(['receiver.example.com' => [$address]]);

    $refused = $refusal('https://receiver.example.com/hook');

    expect($refused->reason)->toBe('private_address')
        ->and($refused->host)->toBe('receiver.example.com');
})->with([
    'loopback' => ['127.0.0.1'],
    'cloud metadata' => ['169.254.169.254'],
    'private network' => ['10.1.2.3'],
    'IPv6 loopback' => ['::1'],
    'unique local' => ['fd00::1'],
    'v4-mapped loopback' => ['::ffff:127.0.0.1'],
    'NAT64 of the metadata' => ['64:ff9b::a9fe:a9fe'],
    '6to4 of loopback' => ['2002:7f00:1::'],
]);

it('refuses a name with one public and one private address', function () use ($refusal) {
    resolver(['receiver.example.com' => ['93.184.216.34', '10.0.0.5']]);

    expect($refusal('https://receiver.example.com/hook')->reason)->toBe('private_address');
});

it('refuses a name that resolves to nothing', function (array $addresses) use ($refusal) {
    resolver(['receiver.example.com' => $addresses]);

    expect($refusal('https://receiver.example.com/hook')->reason)->toBe('unresolvable');
})->with([
    'no address' => [[]],
    'nothing that is an address' => [['receiver.example.com', '']],
]);

it('refuses what is no http address, carries a user or has a host of another form', function (string $url, string $reason) use ($refusal) {
    resolver(['receiver.example.com' => ['93.184.216.34']]);

    expect($refusal($url)->reason)->toBe($reason);
})->with([
    'another scheme' => ['ftp://receiver.example.com/hook', 'scheme'],
    'no scheme' => ['receiver.example.com/hook', 'scheme'],
    'user and password' => ['https://user:pass@receiver.example.com/hook', 'credentials'],
    'a user' => ['https://user@receiver.example.com/hook', 'credentials'],
    'unreadable' => ['https://receiver.example.com:99999/hook', 'unresolvable'],
    'a backslash' => ['http://127.0.0.1\\@receiver.example.com/hook', 'unresolvable'],
    'a blank' => ['https://receiver .example.com/hook', 'unresolvable'],
    'a trailing dot' => ['https://receiver.example.com./hook', 'unresolvable'],
    'a number curl reads as 127.0.0.1' => ['http://2130706433/hook', 'unresolvable'],
    'a short dotted quad' => ['http://127.1/hook', 'unresolvable'],
    'a letter beyond ASCII' => ['https://empfänger.example.com/hook', 'unresolvable'],
    'no host' => ['https:///hook', 'unresolvable'],
]);

it('takes private addresses when allowed', function () {
    config(['werkbuch.webhooks_allow_private' => true]);
    resolver(['receiver.test' => ['127.0.0.1', '::1']]);

    $target = SafeTarget::check('http://receiver.test:8025/hook');

    expect($target->addresses)->toBe(['127.0.0.1', '::1'])
        ->and($target->curlResolve())->toBe('receiver.test:8025:127.0.0.1,[::1]');
});

it('spares only the private networks when private addresses are allowed (A378)', function (string $address, ?string $reason) use ($refusal) {
    config(['werkbuch.webhooks_allow_private' => true]);
    resolver(['receiver.test' => ['10.1.2.3', $address]]);

    if ($reason === null) {
        expect(SafeTarget::check('http://receiver.test/hook')->addresses)->toBe(['10.1.2.3', $address]);

        return;
    }

    expect($refusal('http://receiver.test/hook')->reason)->toBe($reason);
})->with([
    'loopback' => ['127.0.0.1', null],
    'a private network' => ['10.1.2.4', null],
    'carrier-grade NAT' => ['100.64.0.1', null],
    'unique local' => ['fd00::1', null],
    'cloud metadata' => ['169.254.169.254', 'private_address'],
    'link-local' => ['169.254.10.1', 'private_address'],
    'IPv6 link-local' => ['fe80::1', 'private_address'],
    'Alibaba metadata' => ['100.100.100.200', 'private_address'],
    'AWS metadata over IPv6' => ['fd00:ec2::254', 'private_address'],
    'this network' => ['0.0.0.0', 'private_address'],
    'multicast' => ['224.0.0.1', 'private_address'],
    'reserved' => ['240.0.0.1', 'private_address'],
    'v4-mapped metadata' => ['::ffff:169.254.169.254', 'private_address'],
    'NAT64 of the metadata' => ['64:ff9b::a9fe:a9fe', 'private_address'],
]);

it('refuses an address literal outside the private networks when private addresses are allowed', function () use ($refusal) {
    config(['werkbuch.webhooks_allow_private' => true]);

    expect($refusal('http://169.254.169.254/latest/meta-data')->reason)->toBe('private_address')
        ->and($refusal('http://[fe80::1]/hook')->reason)->toBe('private_address');
});

it('still resolves when private addresses are allowed', function () use ($refusal) {
    config(['werkbuch.webhooks_allow_private' => true]);

    expect($refusal('http://receiver.test/hook')->reason)->toBe('unresolvable');
});

it('keeps the port and brackets an IPv6 address', function () {
    resolver(['receiver.example.com' => ['2606:4700::1111']]);

    $target = SafeTarget::check('https://receiver.example.com:8443/hook');

    expect($target->port)->toBe(8443)
        ->and($target->ip)->toBe('2606:4700::1111')
        ->and($target->curlResolve())->toBe('receiver.example.com:8443:[2606:4700::1111]');
});

it('reads a host in capitals as curl sends it', function () {
    $dns = resolver(['receiver.example.com' => ['93.184.216.34']]);

    $target = SafeTarget::check('https://RECEIVER.Example.COM/hook');

    expect($target->host)->toBe('receiver.example.com')
        ->and($target->curlResolve())->toBe('receiver.example.com:443:93.184.216.34')
        ->and($dns->asked())->toBe(['receiver.example.com']);
});

it('checks an address literal without asking DNS and pins nothing', function (string $url, string $ip) {
    config(['werkbuch.webhooks_allow_private' => true]);
    $dns = resolver([]);

    $target = SafeTarget::check($url);

    expect($target->ip)->toBe($ip)
        ->and($target->addresses)->toBe([$ip])
        ->and($target->curlResolve())->toBeNull()
        ->and($dns->asked())->toBe([]);
})->with([
    'IPv4' => ['http://127.0.0.1:8025/hook', '127.0.0.1'],
    'IPv6' => ['http://[::1]:8025/hook', '::1'],
    'IPv6 in another spelling' => ['http://[0:0:0:0:0:0:0:1]/hook', '::1'],
]);

it('refuses a blocked address literal', function (string $url) use ($refusal) {
    expect($refusal($url)->reason)->toBe('private_address');
})->with([
    'loopback' => ['http://127.0.0.1/hook'],
    'IPv6 loopback' => ['http://[::1]/hook'],
]);

it('never names the URL in its message', function () use ($refusal) {
    resolver(['receiver.example.com' => ['10.0.0.5']]);

    $private = $refusal('https://receiver.example.com/hook?token=geheim');
    $credentials = $refusal('https://user:geheim@receiver.example.com/hook');
    $unreadable = $refusal('https://receiver.example.com:99999/hook?token=geheim');

    expect($private->getMessage())->toBe('Webhook target receiver.example.com refused: private_address')
        ->and($credentials->getMessage())->toBe('Webhook target receiver.example.com refused: credentials')
        ->and($unreadable->getMessage())->toBe('Webhook target refused: unresolvable')
        ->and($private->getMessage().$credentials->getMessage().$unreadable->getMessage())->not->toContain('geheim')
        ->and($private->getMessage())->not->toContain('/hook');
});

it('waits for a dead name server at most two seconds, once, unless the environment says otherwise', function () {
    $before = getenv('RES_OPTIONS');
    // the app sets it while it registers, before its first lookup: glibc reads it only then (K17)
    expect($before)->toBe('timeout:2 attempts:1');

    try {
        putenv('RES_OPTIONS');
        DnsResolver::limitWaiting();
        expect(getenv('RES_OPTIONS'))->toBe('timeout:2 attempts:1');

        putenv('RES_OPTIONS=timeout:5');
        DnsResolver::limitWaiting();
        expect(getenv('RES_OPTIONS'))->toBe('timeout:5');
    } finally {
        putenv($before === false ? 'RES_OPTIONS' : "RES_OPTIONS={$before}");
    }
});

it('merges the addresses of the system resolver, IPv4 first, each once', function () {
    $dns = new DnsResolver(
        fn (string $host) => $host === 'receiver.example.com' ? ['93.184.216.34', '93.184.216.34'] : false,
        fn (string $host) => $host === 'receiver.example.com' ? [
            ['host' => 'receiver.example.com', 'type' => 'CNAME', 'target' => 'edge.example.net'],
            ['host' => 'edge.example.net', 'type' => 'AAAA', 'ipv6' => '2606:4700::1111'],
            ['host' => 'edge.example.net', 'type' => 'AAAA'],
        ] : false,
    );

    expect($dns->addresses('receiver.example.com'))->toBe(['93.184.216.34', '2606:4700::1111'])
        ->and($dns->addresses('receiver.invalid'))->toBe([]);
});
