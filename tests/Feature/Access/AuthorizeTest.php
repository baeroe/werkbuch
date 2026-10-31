<?php

use App\Access\Authorize;
use App\Enums\Catalog;
use App\Exceptions\Problem;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Auth\Access\Response;
use Illuminate\Support\Facades\Gate;

beforeEach(function () {
    $this->user = User::factory()->create();
});

it('returns when the policy allows, with the arguments passed on', function () {
    Gate::define('test.allowed', fn (User $user, string $first, string $second) => $user->is($this->user) && $first === 'one' && $second === 'two');

    Authorize::check(actor($this->user), 'test.allowed', 'one', 'two');

    expect(fn () => Authorize::check(actor($this->user), 'test.allowed', 'one', 'three'))->toThrow(Problem::class);
});

it('refuses with the sentence of the policy', function () {
    Gate::define('test.denied', fn () => Response::deny('Nur Admins.'));

    $problem = refusal($this->user, 'test.denied');

    expect($problem->status)->toBe(403)->and($problem->reason)->toBe('forbidden')->and($problem->detail)->toBe('Nur Admins.');
});

it('refuses without a sentence when the policy gives none', function () {
    Gate::define('test.false', fn () => false);

    $problem = refusal($this->user, 'test.false');

    expect($problem->status)->toBe(403)->and($problem->detail)->toBeNull();
});

it('hides what the account must not see as not found, without a detail', function () {
    Gate::define('test.hidden', fn () => Response::denyAsNotFound('Geheim.'));

    $problem = refusal($this->user, 'test.hidden');

    expect($problem->status)->toBe(404)->and($problem->reason)->toBe('not_found')->and($problem->detail)->toBeNull();
});

it('lets org admins and the default bot change every catalog', function (Catalog $catalog) {
    $admin = User::factory()->admin()->create();

    Authorize::check(actor($admin), 'manageCatalog', Organization::class, $catalog);
    Authorize::check(actor(User::defaultBot()), 'manageCatalog', Organization::class, $catalog);

    expect(true)->toBeTrue();
})->with(Catalog::cases());

it('refuses a member with the sentence of the catalog', function (Catalog $catalog) {
    $problem = refusal($this->user, 'manageCatalog', Organization::class, $catalog);

    expect($problem->status)->toBe(403)
        ->and($problem->detail)->toBe($catalog->deniedDetail())
        ->and($problem->detail)->toBe(__('problem.detail.'.match ($catalog) {
            Catalog::Workflows => 'workflows_admins_only',
            Catalog::WorkItemTypes => 'types_admins_only',
            Catalog::Properties => 'properties_admins_only',
            Catalog::Labels => 'labels_admins_only',
            Catalog::RelationTypes => 'relation_types_admins_only',
            Catalog::Resolutions => 'resolutions_admins_only',
        }));
})->with(Catalog::cases());

it('names a different sentence for each catalog', function () {
    $sentences = array_map(fn (Catalog $catalog) => refusal($this->user, 'manageCatalog', Organization::class, $catalog)->detail, Catalog::cases());

    expect(array_unique($sentences))->toHaveCount(count(Catalog::cases()))
        ->and($sentences[0])->not->toStartWith('problem.detail.');
});
