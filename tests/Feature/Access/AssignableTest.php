<?php

use App\Access\Assignable;
use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Models\Project;
use App\Models\User;
use Illuminate\Support\Facades\DB;

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

it('answers the same for every account through check, among and query (T11-M5)', function () {
    $owner = User::factory()->create();
    $accounts = [
        memberOf($this->project, ProjectRole::Viewer),
        memberOf($this->project, ProjectRole::Admin, ['disabled_at' => now()]),
        User::factory()->admin()->create(),
        User::factory()->admin()->disabled()->create(),
        User::factory()->create(),
        User::factory()->bot($owner)->create(),
        User::factory()->bot($owner)->admin()->create(),
        User::defaultBot(),
    ];
    $memberBot = User::factory()->bot($owner)->create();
    app(RoleAssignments::class)->setProjectRole($memberBot, $this->project, ProjectRole::Member);
    $accounts[] = $memberBot;
    $all = User::query()->get();

    $checked = array_values(array_map(fn (User $user) => $user->id, array_filter($all->all(), fn (User $user) => Assignable::check($user, $this->project))));
    sort($checked);
    $among = Assignable::among($all, $this->project);
    sort($among);
    $queried = Assignable::query($this->project)->pluck('id')->sort()->values()->all();

    expect($among)->toBe($checked)
        ->and($queried)->toBe($checked)
        // the world holds every case: some take work, some do not
        ->and(count($checked))->toBeGreaterThan(1)->toBeLessThan(count($accounts));
});

it('finds nobody among no accounts or only disabled ones, without asking the database', function () {
    $disabled = memberOf($this->project, ProjectRole::Member, ['disabled_at' => now()]);
    DB::enableQueryLog();

    expect(Assignable::among([], $this->project))->toBe([])
        ->and(Assignable::among([$disabled], $this->project))->toBe([])
        ->and(DB::getQueryLog())->toBe([]);
});
