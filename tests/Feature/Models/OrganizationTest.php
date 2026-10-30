<?php

use App\Enums\Locale;
use App\Models\Organization;
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
