<?php

use App\Webhooks\DnsResolver;
use App\Webhooks\Resolver;

// The system resolver of the container (K3): /etc/hosts counts (DDEV names host.docker.internal only there)

it('reads the hosts file', function () {
    expect((new DnsResolver)->addresses('localhost'))->toContain('127.0.0.1');
});

it('returns a literal as it is', function (string $literal) {
    expect((new DnsResolver)->addresses($literal))->toBe([$literal]);
})->with(['93.184.216.34', '2606:4700::1111']);

it('resolves nothing for .invalid', function () {
    expect((new DnsResolver)->addresses('receiver.invalid'))->toBe([]);
});

it('is the resolver of the app, once per scope', function () {
    $first = app(Resolver::class);
    expect($first)->toBeInstanceOf(DnsResolver::class)->and(app(Resolver::class))->toBe($first);

    app()->forgetScopedInstances();
    expect(app(Resolver::class))->toBeInstanceOf(DnsResolver::class)->not->toBe($first);
});
