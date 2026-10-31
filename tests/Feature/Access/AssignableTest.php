<?php

use App\Access\Assignable;
use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Models\Project;
use App\Models\User;

beforeEach(function () {
    $this->project = Project::factory()->create();
});

it('lets the members of the project take work, people and bots', function () {
    $person = memberOf($this->project, ProjectRole::Viewer);
    $bot = User::factory()->bot(User::factory()->create())->create();
    app(RoleAssignments::class)->setProjectRole($bot, $this->project, ProjectRole::Member);

    expect(Assignable::check($person, $this->project))->toBeTrue()
        ->and(Assignable::check($bot, $this->project))->toBeTrue();
});

it('lets an org admin take work without being a member, an org member not', function () {
    expect(Assignable::check(User::factory()->admin()->create(), $this->project))->toBeTrue()
        ->and(Assignable::check(User::factory()->create(), $this->project))->toBeFalse();
});

it('lets the default bot take work only as a member', function () {
    $bot = User::defaultBot();

    expect(Assignable::check($bot, $this->project))->toBeFalse();

    app(RoleAssignments::class)->setProjectRole($bot, $this->project, ProjectRole::Member);

    expect(Assignable::check($bot, $this->project))->toBeTrue();
});

it('never lets a disabled account take work', function () {
    $member = memberOf($this->project, ProjectRole::Admin, ['disabled_at' => now()]);
    $admin = User::factory()->admin()->disabled()->create();

    expect(Assignable::check($member, $this->project))->toBeFalse()
        ->and(Assignable::check($admin, $this->project))->toBeFalse();
});
