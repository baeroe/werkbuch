<?php

use App\Enums\Locale;
use App\Models\Organization;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

it('has exactly one organization after the migrations', function () {
    $organization = Organization::current();

    expect(Organization::count())->toBe(1)
        ->and(Str::isUlid($organization->id))->toBeTrue()
        ->and($organization->name)->toBe(config('app.name'))
        ->and($organization->locale)->toBe(Locale::En)
        ->and($organization->week_start)->toBe(1)
        ->and($organization->timezone)->toBe('UTC');
});

it('answers the same instance within a request', function () {
    expect(Organization::current())->toBe(Organization::current());
});

it('maps the organization to its short name', function () {
    expect((new Organization)->getMorphClass())->toBe('organization');
});

it('reads the organization once per request or job and again in the next one', function () {
    app()->forgetScopedInstances();
    $reads = fn (callable $call): int => count(tap(collect(), function ($log) use ($call) {
        DB::listen(fn ($query) => str_contains($query->sql, 'from `organization`') && $log->push($query->sql));
        $call();
    }));

    $first = null;
    expect($reads(function () use (&$first) {
        $first = Organization::current();
        Organization::current();
        Organization::current();
    }))->toBe(1);

    app()->forgetScopedInstances(); // what the queue worker does between two jobs
    $second = null;
    expect($reads(function () use (&$second) {
        $second = Organization::current();
        Organization::current();
    }))->toBe(1)
        ->and($second)->not->toBe($first)
        ->and($second->id)->toBe($first->id);
});
