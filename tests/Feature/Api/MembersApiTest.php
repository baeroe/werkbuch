<?php

use App\Access\ProjectRole;
use App\Access\Visibility;
use App\Actions\Projects\AddMember;
use App\Actions\Projects\CreateProject;
use App\Actions\Projects\RemoveMember;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Favorite;
use App\Models\Project;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/** The shape of `ProjectMember` in resources/js/types.ts. */
const MEMBER_SHAPE = ['project_id', 'user_id', 'role'];

/**
 * A project created by an admin (a member and the lead) with a member and a viewer.
 *
 * @return array{0: Project, 1: User, 2: User, 3: User}
 */
function projectWithPeople(string $identifier = 'WEB', string $visibility = 'public'): array
{
    $mara = User::factory()->create();
    $project = CreateProject::run(actor($mara), ['name' => 'Projekt '.$identifier, 'identifier' => $identifier, 'visibility' => $visibility]);

    return [$project, $mara, memberOf($project, ProjectRole::Member), memberOf($project, ProjectRole::Viewer)];
}

it('lists the members of a project for everybody who sees it', function () {
    [$web, $mara, $member, $viewer] = projectWithPeople();
    $outsider = User::factory()->create();

    $response = $this->actingAs($outsider)->getJson('/api/v1/projects/WEB/members')->assertOk()
        ->assertJsonStructure(['data' => [MEMBER_SHAPE], 'links', 'meta' => ['total']])->assertJsonPath('meta.total', 3);

    // in the order they joined
    expect($response->json('data'))->toBe([
        ['project_id' => $web->id, 'user_id' => $mara->id, 'role' => 'admin'],
        ['project_id' => $web->id, 'user_id' => $member->id, 'role' => 'member'],
        ['project_id' => $web->id, 'user_id' => $viewer->id, 'role' => 'viewer'],
    ]);

    $first = $this->getJson('/api/v1/projects/WEB/members?per_page=2')->assertOk()->assertJsonCount(2, 'data')->assertJsonPath('meta.total', 3);
    $this->getJson('/api/v1/projects/WEB/members?per_page=2&cursor='.$first->json('meta.next_cursor'))->assertOk()
        ->assertJsonPath('data.*.user_id', [$viewer->id]);
});

it('keeps the members of a private project from those who do not see it', function () {
    projectWithPeople('OPS', 'private');

    $this->actingAs(User::factory()->create())->getJson('/api/v1/projects/OPS/members')->assertNotFound()->assertJsonMissingPath('detail');
});

it('adds a member with a role and records it', function () {
    [$web, $mara] = projectWithPeople();
    $lene = User::factory()->create();

    $this->actingAs($mara)->postJson('/api/v1/projects/WEB/members', ['user_id' => $lene->id, 'role' => 'viewer'])
        ->assertCreated()->assertJsonStructure(['data' => MEMBER_SHAPE])
        ->assertJsonPath('data.project_id', $web->id)->assertJsonPath('data.user_id', $lene->id)->assertJsonPath('data.role', 'viewer');

    $event = eventsOf(EventType::ProjectMemberAdded, $web)[0];

    expect(Visibility::roleIn($lene, $web))->toBe(ProjectRole::Viewer)
        ->and(Visibility::isMember($lene, $web))->toBeTrue()
        ->and($event->actor_id)->toBe($mara->id)
        ->and($event->project_id)->toBe($web->id)
        ->and($event->changes)->toBe(['member' => ['old' => null, 'new' => ['user_id' => $lene->id, 'role' => 'viewer']]]);
});

it('takes a user id in upper case for the account it names', function () {
    [$web, $mara] = projectWithPeople();
    $lene = User::factory()->create();

    $this->actingAs($mara)->postJson('/api/v1/projects/WEB/members', ['user_id' => strtoupper($lene->id), 'role' => 'member'])
        ->assertCreated()->assertJsonPath('data.user_id', $lene->id);
});

it('refuses an account that is a member already', function () {
    [, $mara, $member] = projectWithPeople();

    $this->actingAs($mara)->postJson('/api/v1/projects/WEB/members', ['user_id' => $member->id, 'role' => 'admin'])
        ->assertUnprocessable()->assertJsonPath('errors.user_id.0', __('field.user.already_member'));

    expect(Visibility::roleIn($member, Project::query()->sole()))->toBe(ProjectRole::Member);
});

it('refuses an account that is deactivated, does not exist or is not named', function (mixed $user) {
    [, $mara] = projectWithPeople();
    $gone = User::factory()->create(['disabled_at' => now()]);

    $this->actingAs($mara)->postJson('/api/v1/projects/WEB/members', ['user_id' => $user === 'gone' ? $gone->id : $user, 'role' => 'member'])
        ->assertUnprocessable()->assertJsonPath('errors.user_id.0', __('field.user.inactive'));
})->with(['deactivated' => 'gone', 'unknown' => '01jzzzzzzzzzzzzzzzzzzzzzzz', 'not named' => null, 'not a text' => [['a']]]);

it('refuses a role that does not exist', function (mixed $role) {
    [, $mara] = projectWithPeople();
    $lene = User::factory()->create();

    $this->actingAs($mara)->postJson('/api/v1/projects/WEB/members', ['user_id' => $lene->id, 'role' => $role])
        ->assertUnprocessable()->assertJsonPath('errors.role.0', __('field.project_role.unknown'));

    expect(Visibility::isMember($lene, Project::query()->sole()))->toBeFalse();
})->with(['unknown' => 'owner', 'not named' => null, 'not a text' => [['admin']]]);

it('adds a bot, and the default bot as an explicit member', function () {
    [$web, $mara] = projectWithPeople();
    $bot = User::factory()->bot($mara)->create();

    $this->actingAs($mara)->postJson('/api/v1/projects/WEB/members', ['user_id' => $bot->id, 'role' => 'member'])->assertCreated();
    $this->postJson('/api/v1/projects/WEB/members', ['user_id' => User::defaultBot()->id, 'role' => 'viewer'])->assertCreated()
        ->assertJsonPath('data.user_id', User::defaultBot()->id);

    // the default bot is an org admin: it sees and manages the project without being a member, and still is no member
    expect(Visibility::isMember($bot, $web))->toBeTrue()
        ->and(Visibility::isMember(User::defaultBot(), $web))->toBeTrue()
        ->and($this->getJson('/api/v1/projects/WEB/members')->json('meta.total'))->toBe(5);
});

it('lets only admins of the project manage its members', function () {
    [, , $member, $viewer] = projectWithPeople();
    $lene = User::factory()->create();

    foreach ([$member, $viewer] as $account) {
        $this->actingAs($account);
        $detail = __('problem.detail.members_admins_only');

        $this->postJson('/api/v1/projects/WEB/members', ['user_id' => $lene->id, 'role' => 'member'])->assertForbidden()->assertJsonPath('detail', $detail);
        $this->patchJson("/api/v1/projects/WEB/members/{$viewer->id}", ['role' => 'admin'])->assertForbidden()->assertJsonPath('detail', $detail);
        $this->deleteJson("/api/v1/projects/WEB/members/{$viewer->id}")->assertForbidden()->assertJsonPath('detail', $detail);
    }

    expect(Visibility::isMember($lene, Project::query()->sole()))->toBeFalse();
});

it('changes the role of a member and records old and new', function () {
    [$web, $mara, $member] = projectWithPeople();

    $this->actingAs($mara)->patchJson("/api/v1/projects/WEB/members/{$member->id}", ['role' => 'admin'])
        ->assertOk()->assertJsonStructure(['data' => MEMBER_SHAPE])->assertJsonPath('data.role', 'admin')->assertJsonPath('data.user_id', $member->id);

    // the same again changes nothing
    $this->patchJson("/api/v1/projects/WEB/members/{$member->id}", ['role' => 'admin'])->assertOk()->assertJsonPath('data.role', 'admin');

    $events = eventsOf(EventType::ProjectMemberRoleChanged, $web);

    expect(Visibility::roleIn($member, $web))->toBe(ProjectRole::Admin)
        ->and($events)->toHaveCount(1)
        ->and($events[0]->actor_id)->toBe($mara->id)
        ->and($events[0]->project_id)->toBe($web->id)
        ->and($events[0]->changes)->toBe(['member' => [
            'old' => ['user_id' => $member->id, 'role' => 'member'],
            'new' => ['user_id' => $member->id, 'role' => 'admin'],
        ]]);
});

it('lets the lead have any role: the lead has no rights of its own', function () {
    [$web, $mara] = projectWithPeople();
    $lene = memberOf($web, ProjectRole::Admin);
    $web->update(['lead_id' => $lene->id]);

    $this->actingAs($mara)->patchJson("/api/v1/projects/WEB/members/{$lene->id}", ['role' => 'viewer'])->assertOk()->assertJsonPath('data.role', 'viewer');
});

it('refuses a role that does not exist when changing it', function (mixed $role) {
    [, $mara, $member] = projectWithPeople();

    $this->actingAs($mara)->patchJson("/api/v1/projects/WEB/members/{$member->id}", ['role' => $role])
        ->assertUnprocessable()->assertJsonPath('errors.role.0', __('field.project_role.unknown'));

    expect(Visibility::roleIn($member, Project::query()->sole()))->toBe(ProjectRole::Member);
})->with(['unknown' => 'owner', 'not named' => null, 'not a text' => [['admin']]]);

it('does not find an account that is no member', function () {
    [, $mara] = projectWithPeople();
    $lene = User::factory()->create();

    $this->actingAs($mara)->patchJson("/api/v1/projects/WEB/members/{$lene->id}", ['role' => 'admin'])->assertNotFound()->assertJsonMissingPath('detail');
    $this->deleteJson("/api/v1/projects/WEB/members/{$lene->id}")->assertNotFound();
    $this->deleteJson('/api/v1/projects/WEB/members/01jzzzzzzzzzzzzzzzzzzzzzzz')->assertNotFound();
});

it('removes a member and records who left with which role', function () {
    [$web, $mara, $member] = projectWithPeople();

    $this->actingAs($mara)->deleteJson("/api/v1/projects/WEB/members/{$member->id}")->assertNoContent();

    $event = eventsOf(EventType::ProjectMemberRemoved, $web)[0];

    expect(Visibility::isMember($member, $web))->toBeFalse()
        // a public project stays visible, as to anybody else
        ->and(Visibility::roleIn($member, $web))->toBe(ProjectRole::Viewer)
        ->and($event->actor_id)->toBe($mara->id)
        ->and($event->project_id)->toBe($web->id)
        ->and($event->changes)->toBe(['member' => ['old' => ['user_id' => $member->id, 'role' => 'member'], 'new' => null]]);
});

it('keeps the lead a member', function () {
    [$web, $mara] = projectWithPeople();

    $this->actingAs($mara)->deleteJson("/api/v1/projects/WEB/members/{$mara->id}")
        ->assertStatus(409)->assertJsonPath('reason', 'lead_cannot_leave')->assertJsonPath('detail', __('problem.reason.lead_cannot_leave'));

    expect(Visibility::isMember($mara, $web))->toBeTrue()->and(eventsOf(EventType::ProjectMemberRemoved, $web))->toBeEmpty();

    // somebody else leads: the old lead may leave now
    $this->patchJson('/api/v1/projects/WEB', ['lead_id' => memberOf($web, ProjectRole::Member)->id])->assertOk();
    $this->deleteJson("/api/v1/projects/WEB/members/{$mara->id}")->assertNoContent();
});

it('loses the project in the next call after removal', function () {
    [, $mara, $member] = projectWithPeople('OPS', 'private');
    CreateProject::run(actor($mara), ['name' => 'Offen', 'identifier' => 'WEB']);

    // the visible projects of an account are kept for the request, and in a test across calls (P33)
    $this->actingAs($member)->getJson('/api/v1/projects/OPS')->assertOk()->assertJsonPath('data.my_role', 'member');
    $this->postJson('/api/v1/favorites/toggle', ['kind' => 'project', 'id' => Project::query()->where('identifier', 'OPS')->sole()->id])->assertOk();
    $this->getJson('/api/v1/favorites')->assertJsonPath('meta.total', 1);
    $this->getJson('/api/v1/projects')->assertJsonPath('meta.total', 2);

    $this->actingAs($mara)->deleteJson("/api/v1/projects/OPS/members/{$member->id}")->assertNoContent();

    $this->actingAs($member)->getJson('/api/v1/projects/OPS')->assertNotFound();
    $this->getJson('/api/v1/projects')->assertJsonPath('data.*.identifier', ['WEB']);
    $this->getJson('/api/v1/favorites')->assertOk()->assertJsonPath('meta.total', 0)->assertJsonPath('data', []);

    // the favorite stays and comes back with the access
    expect(Favorite::query()->where('user_id', $member->id)->count())->toBe(1);
    $this->actingAs($mara)->postJson('/api/v1/projects/OPS/members', ['user_id' => $member->id, 'role' => 'viewer'])->assertCreated();
    $this->actingAs($member)->getJson('/api/v1/favorites')->assertJsonPath('meta.total', 1);
});

it('sees a new membership in the next call', function () {
    [, $mara] = projectWithPeople('OPS', 'private');
    $lene = User::factory()->create();

    $this->actingAs($lene)->getJson('/api/v1/projects/OPS')->assertNotFound();
    $this->actingAs($mara)->postJson('/api/v1/projects/OPS/members', ['user_id' => $lene->id, 'role' => 'member'])->assertCreated();
    $this->actingAs($lene)->getJson('/api/v1/projects/OPS')->assertOk()->assertJsonPath('data.my_role', 'member');

    $this->actingAs($mara)->patchJson("/api/v1/projects/OPS/members/{$lene->id}", ['role' => 'admin'])->assertOk();
    $this->actingAs($lene)->getJson('/api/v1/projects/OPS')->assertJsonPath('data.my_role', 'admin');
});

it('joins a public project as a member with one click', function () {
    [$web] = projectWithPeople();
    $lene = User::factory()->create();

    $this->actingAs($lene)->postJson('/api/v1/projects/WEB/join')->assertCreated()->assertJsonStructure(['data' => MEMBER_SHAPE])
        ->assertJsonPath('data.project_id', $web->id)->assertJsonPath('data.user_id', $lene->id)->assertJsonPath('data.role', 'member');

    $event = eventsOf(EventType::ProjectMemberAdded, $web)[0];

    expect(Visibility::roleIn($lene, $web))->toBe(ProjectRole::Member)
        ->and($event->actor_id)->toBe($lene->id)
        ->and($event->project_id)->toBe($web->id)
        ->and($event->changes)->toBe(['member' => ['old' => null, 'new' => ['user_id' => $lene->id, 'role' => 'member']]]);

    $this->getJson('/api/v1/projects/WEB')->assertJsonPath('data.my_role', 'member');
});

it('answers a second join with the project named', function () {
    [$web, , $member, $viewer] = projectWithPeople();
    $lene = User::factory()->create();

    $this->actingAs($lene)->postJson('/api/v1/projects/WEB/join')->assertCreated();
    $this->postJson('/api/v1/projects/WEB/join')->assertStatus(409)
        ->assertJsonPath('reason', 'already_member')->assertJsonPath('detail', __('problem.detail.already_member', ['identifier' => 'WEB']));

    // a viewer or a member by choice is a member as well, and keeps the role
    $this->actingAs($viewer)->postJson('/api/v1/projects/WEB/join')->assertStatus(409)->assertJsonPath('reason', 'already_member');
    $this->actingAs($member)->postJson('/api/v1/projects/WEB/join')->assertStatus(409);

    expect(Visibility::roleIn($viewer, $web))->toBe(ProjectRole::Viewer)
        ->and(eventsOf(EventType::ProjectMemberAdded, $web))->toHaveCount(1);
});

it('does not let anybody join a private project but its org admins', function () {
    [$ops] = projectWithPeople('OPS', 'private');
    $admin = User::factory()->admin()->create();

    $this->actingAs(User::factory()->create())->postJson('/api/v1/projects/OPS/join')->assertNotFound()->assertJsonMissingPath('detail');
    $this->actingAs($admin)->postJson('/api/v1/projects/OPS/join')->assertCreated()->assertJsonPath('data.role', 'member');

    expect(Visibility::isMember($admin, $ops))->toBeTrue();
});

it('lets no account of a project that is being deleted change its members', function () {
    [$web, $mara] = projectWithPeople();
    $lene = User::factory()->create();
    $stale = Project::query()->findOrFail($web->id);
    Project::query()->whereKey($web->id)->update(['deleting_at' => now()]);

    // the model was read before the deletion began: the lock finds the mark
    foreach ([
        fn () => AddMember::run(actor($mara), $stale, ['user_id' => $lene->id, 'role' => 'member']),
        fn () => RemoveMember::run(actor($mara), $stale, $lene),
    ] as $call) {
        expect($call)->toThrow(fn (Problem $problem) => $problem->status === 404);
    }
});

it('joins a project through a token with write and refuses one that only reads', function () {
    [, $mara] = projectWithPeople();
    $lene = User::factory()->create();

    $this->withToken(apiToken($lene, ['read']))->postJson('/api/v1/projects/WEB/join')->assertForbidden()->assertJsonPath('reason', 'forbidden');
    forgetApiAuth();
    $this->withToken(apiToken($lene, ['write']))->postJson('/api/v1/projects/WEB/join')->assertCreated();

    expect(DB::table('project_members')->where('user_id', $lene->id)->count())->toBe(1)->and($mara->id)->not->toBe($lene->id);
});
