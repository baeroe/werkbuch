<?php

use App\Http\Api\RateKey;
use App\Support\RunnerDist;
use Illuminate\Support\Facades\RateLimiter;
use Symfony\Component\Process\Process;

/*
 * The runner from the instance (spec 8.2, 8.3, A520): /runner/install.sh and /runner/download/<os>/<arch> with its
 * .sha256, without an account (neither is a secret), without a session, throttled per address, refusals as problems.
 */

beforeEach(function () {
    $this->dist = sys_get_temp_dir().'/werkbuch-dist-'.bin2hex(random_bytes(4));
    mkdir($this->dist);
    config(['werkbuch.runner_dist' => $this->dist]);
});

afterEach(function () {
    array_map('unlink', glob($this->dist.'/*') ?: []);
    rmdir($this->dist);
});

/** A built runner in the dist folder, as the image and `ddev runner-build` leave it. */
$build = function (string $folder, string $os, string $arch, string $bytes): string {
    $name = "werkbuch-runner-{$os}-{$arch}";
    file_put_contents("{$folder}/{$name}", $bytes);
    file_put_contents("{$folder}/{$name}.sha256", hash('sha256', $bytes)."  {$name}\n");

    return hash('sha256', $bytes);
};

it('serves the binary of the instance version with its checksum', function () use ($build) {
    $sum = $build($this->dist, 'darwin', 'arm64', "\xCF\xFA\xED\xFEbinary of 0.3.2");

    $binary = $this->get('/runner/download/darwin/arm64')->assertOk();
    expect($binary->headers->get('Content-Type'))->toBe('application/octet-stream')
        ->and($binary->headers->get('Content-Disposition'))->toBe('attachment; filename=werkbuch-runner')
        ->and($binary->headers->get('Cache-Control'))->toContain('no-store')
        ->and($binary->headers->get('X-Content-Type-Options'))->toBe('nosniff')
        ->and($binary->headers->getCookies())->toBe([])
        ->and(file_get_contents($binary->baseResponse->getFile()->getPathname()))->toBe("\xCF\xFA\xED\xFEbinary of 0.3.2");

    $checksum = $this->get('/runner/download/darwin/arm64.sha256')->assertOk();
    expect($checksum->getContent())->toBe("{$sum}  werkbuch-runner-darwin-arm64\n")
        ->and($checksum->headers->get('Content-Type'))->toBe('text/plain; charset=utf-8')
        ->and($checksum->headers->get('Cache-Control'))->toContain('no-store')
        ->and($checksum->headers->getCookies())->toBe([]);
});

it('refuses an unknown os or arch with 404', function (string $path) use ($build) {
    foreach (RunnerDist::TARGETS as [$os, $arch]) {
        $build($this->dist, $os, $arch, 'x');
    }
    $build($this->dist, 'windows', 'amd64', 'x');

    $answer = $this->get($path)->assertNotFound();
    expect($answer->headers->get('Content-Type'))->toBe('application/problem+json')
        ->and($answer->json('reason'))->toBe('not_found');
})->with([
    'windows' => '/runner/download/windows/amd64',
    'windows sum' => '/runner/download/windows/amd64.sha256',
    'riscv' => '/runner/download/linux/riscv64',
    'upper case' => '/runner/download/Linux/amd64',
    'a path' => '/runner/download/linux/..%2F..%2Fetc%2Fpasswd',
    'no arch' => '/runner/download/linux',
]);

it('answers 404 for a runner the instance has not built', function () use ($build) {
    $build($this->dist, 'linux', 'amd64', 'x');

    $this->get('/runner/download/linux/arm64')->assertNotFound()->assertHeader('Content-Type', 'application/problem+json');
    $this->get('/runner/download/linux/arm64.sha256')->assertNotFound();
    $this->get('/runner/download/linux/amd64')->assertOk();
});

it('builds every target the installer and the update ask for', function () {
    expect(RunnerDist::TARGETS)->toBe([['darwin', 'arm64'], ['darwin', 'amd64'], ['linux', 'arm64'], ['linux', 'amd64']])
        ->and(RunnerDist::path('darwin', 'arm64'))->toBe($this->dist.'/werkbuch-runner-darwin-arm64')
        ->and(RunnerDist::path('linux', 'arm64.sha256'))->toBeNull();
});

it('serves the installer with the address of the instance', function () {
    config(['app.url' => 'https://werkbuch.example.com']);

    $answer = $this->get('/runner/install.sh')->assertOk();
    $script = $answer->getContent();

    expect($answer->headers->get('Content-Type'))->toBe('text/plain; charset=utf-8')
        ->and($answer->headers->get('Cache-Control'))->toContain('no-store')
        ->and($answer->headers->get('X-Content-Type-Options'))->toBe('nosniff')
        ->and($answer->headers->getCookies())->toBe([])
        ->and($script)->toStartWith("#!/bin/sh\n")
        ->and($script)->toContain("WERKBUCH_URL='https://werkbuch.example.com'\n")
        ->and($script)->not->toContain('__WERKBUCH_URL__');

    $file = tempnam(sys_get_temp_dir(), 'install');
    file_put_contents($file, $script);
    $check = new Process(['sh', '-n', $file]);
    $check->run();
    unlink($file);
    expect($check->getExitCode())->toBe(0, $check->getErrorOutput());
});

it('quotes the address of the instance for the shell', function () {
    config(['app.url' => "https://werkbuch.example.com/it's/"]);

    expect(RunnerDist::script())->toContain("WERKBUCH_URL='https://werkbuch.example.com/it'\\''s'\n");
});

it('throttles the downloads per address', function () use ($build) {
    $build($this->dist, 'linux', 'amd64', 'x');
    RateLimiter::clear(md5('runner-download'.RateKey::IP.'127.0.0.1'));

    for ($i = 0; $i < 30; $i++) {
        $this->get($i % 2 === 0 ? '/runner/download/linux/amd64.sha256' : '/runner/install.sh')->assertOk();
    }
    $refused = $this->get('/runner/download/linux/amd64')->assertTooManyRequests();
    expect($refused->headers->get('Content-Type'))->toBe('application/problem+json')
        ->and($refused->json('reason'))->toBe('too_many_requests')
        ->and($refused->headers->has('Retry-After'))->toBeTrue();
});
