<?php

use App\Support\LiveAddress;

it('takes host, port and scheme from APP_URL behind a TLS proxy', function () {
    expect(LiveAddress::from('https://pm.example.com', null, null, null))
        ->toBe(['host' => 'pm.example.com', 'port' => 443, 'scheme' => 'https']);
});

it('keeps the port of APP_URL', function () {
    expect(LiveAddress::from('http://localhost:7740', null, null, null))
        ->toBe(['host' => 'localhost', 'port' => 7740, 'scheme' => 'http']);
});

it('lets REVERB_PUBLIC_PORT point at a port of its own as in DDEV', function () {
    expect(LiveAddress::from('https://werkbuch.ddev.site', null, '6001', null))
        ->toBe(['host' => 'werkbuch.ddev.site', 'port' => 6001, 'scheme' => 'https']);
});

it('and the CI', function () {
    expect(LiveAddress::from('http://127.0.0.1:8000', null, '8080', null))
        ->toBe(['host' => '127.0.0.1', 'port' => 8080, 'scheme' => 'http']);
});

it('takes a host and a scheme of its own', function () {
    expect(LiveAddress::from('http://app.local', 'Live.Example.com', 443, 'HTTPS'))
        ->toBe(['host' => 'Live.Example.com', 'port' => 443, 'scheme' => 'https']);
});

it('ignores a port or scheme it cannot use', function (mixed $port, mixed $scheme) {
    expect(LiveAddress::from('https://pm.example.com', '', $port, $scheme))
        ->toBe(['host' => 'pm.example.com', 'port' => 443, 'scheme' => 'https']);
})->with([
    'empty' => ['', ''],
    'text' => ['abc', 'wss'],
    'zero' => ['0', 'ftp'],
    'too large' => ['70000', 5],
]);

it('has no host without a usable APP_URL', function (mixed $url) {
    expect(LiveAddress::from($url, null, null, null)['host'])->toBeNull();
})->with([null, '', 'not a url']);

it('falls back to https and 443 without any URL', function () {
    expect(LiveAddress::from(null, null, null, null))->toBe(['host' => null, 'port' => 443, 'scheme' => 'https']);
});

it('writes the host of APP_URL in lower case', function () {
    expect(LiveAddress::from('https://PM.Example.COM', null, null, null)['host'])->toBe('pm.example.com');
});

it('keeps an IPv6 host of APP_URL in brackets, as pusher-js puts it into the URL', function (string $url, string $host, int $port) {
    expect(LiveAddress::from($url, null, null, null))->toBe(['host' => $host, 'port' => $port, 'scheme' => 'http']);
})->with([
    'loopback with port' => ['http://[::1]:7740', '[::1]', 7740],
    'upper case' => ['http://[FE80::1]/werkbuch', '[fe80::1]', 80],
]);

it('puts a bare IPv6 address of REVERB_PUBLIC_HOST into brackets', function (string $given, string $host) {
    expect(LiveAddress::from('https://pm.example.com', $given, null, null)['host'])->toBe($host);
})->with([
    'bare' => ['::1', '[::1]'],
    'bare, upper case' => ['2001:DB8::5', '[2001:db8::5]'],
    'in brackets already' => ['[::1]', '[::1]'],
    'IPv4' => ['192.0.2.7', '192.0.2.7'],
]);
