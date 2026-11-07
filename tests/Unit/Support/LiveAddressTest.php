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
