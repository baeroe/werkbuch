<?php

use App\Enums\ProjectVisibility;
use App\Models\Favorite;
use App\Models\Project;
use App\Models\ProjectIdentifier;
use App\Models\ProjectMember;
use App\Models\User;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Str;

it('finds a project by id, identifier and former identifier in any case', function () {
    $project = Project::factory()->identifier('WEB')->create();
    $project->identifiers()->create(['identifier' => 'SITE']);

    expect(Project::findByReference($project->id)?->is($project))->toBeTrue()
        ->and(Project::findByReference(strtoupper($project->id))?->is($project))->toBeTrue()
        ->and(Project::findByReference('web')?->is($project))->toBeTrue()
        ->and(Project::findByReference('SITE')?->is($project))->toBeTrue()
        ->and(Project::findByReference('site')?->is($project))->toBeTrue()
        ->and(Project::findByReference('NOPE'))->toBeNull()
        ->and(Project::findByReference((string) Str::ulid()))->toBeNull();
});

it('stores a project with typed columns and a lead', function () {
    $project = Project::factory()->private()->archived()->create();

    expect(Str::isUlid($project->id))->toBeTrue()
        ->and($project->visibility)->toBe(ProjectVisibility::Private)
        ->and($project->archived_at)->not->toBeNull()
        ->and($project->deleting_at)->toBeNull()
        ->and($project->next_number)->toBe(0)
        ->and($project->description)->toBe('')
        ->and($project->lead)->toBeInstanceOf(User::class)
        ->and(Project::factory()->public()->create()->visibility)->toBe(ProjectVisibility::Public);
});

it('refuses a second project with the same identifier', function () {
    Project::factory()->identifier('WEB')->create();

    Project::factory()->identifier('WEB')->create();
})->throws(UniqueConstraintViolationException::class);

it('refuses the same membership twice', function () {
    $project = Project::factory()->create();
    $user = User::factory()->create();
    $project->memberships()->create(['user_id' => $user->id]);

    $project->memberships()->create(['user_id' => $user->id]);
})->throws(UniqueConstraintViolationException::class);

it('refuses the same former identifier twice', function () {
    $project = Project::factory()->create();
    $project->identifiers()->create(['identifier' => 'OLD']);

    Project::factory()->create()->identifiers()->create(['identifier' => 'OLD']);
})->throws(UniqueConstraintViolationException::class);

it('removes identifiers and memberships with the project', function () {
    $project = Project::factory()->create();
    $project->identifiers()->create(['identifier' => 'OLD']);
    $project->memberships()->create(['user_id' => User::factory()->create()->id]);

    $project->delete();

    expect(ProjectIdentifier::count())->toBe(0)->and(ProjectMember::count())->toBe(0);
});

it('reaches the project and the account from identifiers and memberships', function () {
    $project = Project::factory()->create();
    $user = User::factory()->create();
    $identifier = $project->identifiers()->create(['identifier' => 'OLD']);
    $member = $project->memberships()->create(['user_id' => $user->id]);

    expect($identifier->project->is($project))->toBeTrue()
        ->and($member->project->is($project))->toBeTrue()
        ->and($member->user->is($user))->toBeTrue();
});

it('keeps favorites of an account in a position and resolves what they point to', function () {
    $project = Project::factory()->create();
    $user = User::factory()->create();
    $favorite = Favorite::factory()->create([
        'user_id' => $user->id, 'favoritable_id' => $project->id, 'position' => 2,
    ]);

    expect($favorite->favoritable_type)->toBe('project')
        ->and($favorite->favoritable)->toBeInstanceOf(Project::class)
        ->and($favorite->favoritable?->is($project))->toBeTrue()
        ->and($favorite->user->is($user))->toBeTrue();
});

it('refuses the same favorite twice and drops favorites with the account', function () {
    $project = Project::factory()->create();
    $user = User::factory()->create();
    $attributes = ['user_id' => $user->id, 'favoritable_id' => $project->id];
    Favorite::factory()->create($attributes);

    expect(fn () => Favorite::factory()->create($attributes))->toThrow(UniqueConstraintViolationException::class);

    $user->delete();

    expect(Favorite::count())->toBe(0);
});
