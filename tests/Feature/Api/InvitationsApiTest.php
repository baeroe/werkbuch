<?php

use App\Access\OrgRole;
use App\Access\RoleAssignments;
use App\Events\EventType;
use App\Models\Event;
use App\Models\Invitation;
use App\Models\Project;
use App\Models\User;
use App\Support\InvitationLinks;

const INVITATION_SHAPE = ['id', 'email', 'org_role', 'projects', 'link', 'state', 'created_by', 'created_at', 'expires_at'];

it('invites an address and answers the link and the invitation', function () {
    $admin = User::factory()->admin()->create();
    $web = Project::factory()->identifier('WEB')->create();

    $response = $this->actingAs($admin)->postJson('/api/v1/invitations', [
        'email' => ' Lea@Example.com ', 'org_role' => 'member', 'projects' => [['project_id' => $web->id, 'role' => 'viewer']],
    ])->assertCreated()->assertJsonStructure(['link', 'invitation' => INVITATION_SHAPE])->assertJsonMissingPath('data');

    $invitation = Invitation::query()->sole();
    expect($response->json('link'))->toStartWith(config('app.url'))->toBe(InvitationLinks::for($invitation))
        ->and($response->json('invitation'))->toBe([
            'id' => $invitation->id,
            'email' => 'lea@example.com',
            'org_role' => 'member',
            'projects' => [['project_id' => $web->id, 'role' => 'viewer']],
            'link' => $response->json('link'),
            'state' => 'open',
            'created_by' => $admin->id,
            'created_at' => $invitation->created_at->toJSON(),
            'expires_at' => $invitation->created_at->addDays(7)->toJSON(),
        ])
        ->and(Event::query()->where('type', EventType::UserInvited)->sole()->actor_id)->toBe($admin->id);
});

it('invites without projects', function () {
    $this->actingAs(User::factory()->admin()->create())->postJson('/api/v1/invitations', ['email' => 'lea@example.com', 'org_role' => 'admin'])
        ->assertCreated()->assertJsonPath('invitation.projects', [])->assertJsonPath('invitation.org_role', 'admin');
});

it('lets only org admins invite and list', function () {
    app()->setLocale('de');
    $member = User::factory()->create();

    $this->actingAs($member)->postJson('/api/v1/invitations', ['email' => 'lea@example.com', 'org_role' => 'member'])
        ->assertForbidden()->assertJsonPath('detail', 'Einladen dürfen nur Org-Admins.');
    $this->getJson('/api/v1/invitations')->assertForbidden()->assertJsonPath('detail', 'Einladungen sehen nur Org-Admins.');

    expect(Invitation::query()->exists())->toBeFalse();
});

it('refuses the address of an existing account, also in another spelling', function (string $email) {
    User::factory()->disabled()->create(['email' => 'lea@example.com']);

    $this->actingAs(User::factory()->admin()->create())->postJson('/api/v1/invitations', ['email' => $email, 'org_role' => 'member'])
        ->assertUnprocessable()->assertJsonPath('errors.email', [__('field.email.account_exists')]);

    expect(Invitation::query()->exists())->toBeFalse();
})->with(['lea@example.com', ' LEA@example.com ']);

it('wants a valid address, a role of the organization and a list of projects with roles', function () {
    app()->setLocale('de');

    $this->actingAs(User::factory()->admin()->create())->postJson('/api/v1/invitations', ['email' => 'lea', 'org_role' => 'owner', 'projects' => 'WEB'])
        ->assertUnprocessable()
        ->assertJsonPath('errors.email', ['Das ist keine gültige E-Mail-Adresse.'])
        ->assertJsonPath('errors.org_role', ['Diese Rolle gibt es nicht.'])
        ->assertJsonPath('errors.projects', ['Die Projekte müssen eine Liste sein.']);

    $this->postJson('/api/v1/invitations', ['email' => ['x'], 'org_role' => ['x']])->assertUnprocessable()
        ->assertJsonPath('errors.email', ['Das ist keine gültige E-Mail-Adresse.'])
        ->assertJsonPath('errors.org_role', ['Diese Rolle gibt es nicht.']);
    $this->postJson('/api/v1/invitations', [])->assertUnprocessable()
        ->assertJsonPath('errors.email', ['Das ist keine gültige E-Mail-Adresse.'])
        ->assertJsonPath('errors.org_role', ['Diese Rolle gibt es nicht.']);

    expect(Invitation::query()->exists())->toBeFalse();
});

it('wants projects that exist and are visible, each with a role', function (Closure $projects, array $errors) {
    $ghost = Project::factory()->create(['deleting_at' => now()]);

    $this->actingAs(User::factory()->admin()->create())->postJson('/api/v1/invitations', [
        'email' => 'lea@example.com', 'org_role' => 'member', 'projects' => $projects($ghost),
    ])->assertUnprocessable()->assertJsonValidationErrors($errors);

    expect(Invitation::query()->exists())->toBeFalse();
})->with([
    'a project being deleted, which nobody sees' => [fn (Project $ghost) => [['project_id' => $ghost->id, 'role' => 'member']], ['projects.0.project_id']],
    'an unknown project' => [fn () => [['project_id' => '01JAAAAAAAAAAAAAAAAAAAAAAA', 'role' => 'member']], ['projects.0.project_id']],
    'no text as the project' => [fn () => [['project_id' => ['x'], 'role' => 'member']], ['projects.0.project_id']],
    'an entry without anything' => [fn () => ['WEB'], ['projects.0.project_id', 'projects.0.role']],
    'an unknown role' => [fn () => [['project_id' => Project::factory()->create()->id, 'role' => 'owner']], ['projects.0.role']],
    'no text as the role' => [fn () => [['project_id' => Project::factory()->create()->id, 'role' => ['x']]], ['projects.0.role']],
]);

it('says which project and which role is wrong in the language of the request', function () {
    app()->setLocale('de');

    $this->actingAs(User::factory()->admin()->create())->postJson('/api/v1/invitations', [
        'email' => 'lea@example.com', 'org_role' => 'member', 'projects' => [['project_id' => 'x', 'role' => 'owner']],
    ])->assertUnprocessable()
        ->assertJsonPath('errors', ['projects.0.project_id' => ['Mindestens ein Projekt gibt es nicht.'], 'projects.0.role' => ['Diese Rolle gibt es nicht.']]);
});

it('lists the open invitations, without accepted and expired ones', function () {
    $admin = User::factory()->admin()->create();
    $open = Invitation::factory()->create(['email' => 'open@example.com', 'invited_by' => $admin->id]);
    Invitation::factory()->expired()->create();
    Invitation::factory()->accepted()->create();

    $response = $this->actingAs($admin)->getJson('/api/v1/invitations')->assertOk()
        ->assertJsonPath('meta.total', 1)
        ->assertJsonStructure(['data' => ['*' => INVITATION_SHAPE], 'links', 'meta' => ['path', 'per_page', 'next_cursor', 'prev_cursor', 'total']]);

    expect($response->json('data.0.id'))->toBe($open->id)->and($response->json('data.0.link'))->toBe(InvitationLinks::for($open));
});

it('pages through the invitations', function () {
    Invitation::factory()->count(3)->create();

    $first = $this->actingAs(User::factory()->admin()->create())->getJson('/api/v1/invitations?per_page=2')->assertOk()->assertJsonPath('meta.total', 3);
    $second = $this->getJson('/api/v1/invitations?per_page=2&cursor='.$first->json('meta.next_cursor'))->assertOk();

    expect(array_merge($first->json('data.*.id'), $second->json('data.*.id')))->toHaveCount(3)->and(count(array_unique(array_merge($first->json('data.*.id'), $second->json('data.*.id')))))->toBe(3);
});

it('shows the link only to the session and to tokens that write, never to a read-only token', function () {
    $admin = User::factory()->admin()->create();
    $invitation = Invitation::factory()->create(['invited_by' => $admin->id]);
    Invitation::factory()->create(['invited_by' => $admin->id]);

    $links = fn () => $this->getJson('/api/v1/invitations')->assertOk()->json('data.*.link');

    $this->withToken(apiToken($admin, ['read']));
    expect($links())->toBe([null, null]);

    forgetApiAuth();
    $this->withToken(apiToken($admin, ['read', 'mcp']));
    expect($links())->toBe([null, null]);

    forgetApiAuth();
    $this->withToken(apiToken($admin, ['read', 'write']));
    expect($links())->toContain(InvitationLinks::for($invitation))->each->toStartWith(config('app.url'));

    forgetApiAuth();
    $this->withToken(apiToken($admin, ['write']))->postJson('/api/v1/invitations', ['email' => 'lea@example.com', 'org_role' => 'member'])
        ->assertCreated()->assertJsonPath('invitation.link', fn ($link) => str_starts_with($link, config('app.url')))
        ->assertJsonPath('link', fn ($link) => str_starts_with($link, config('app.url')));
});

it('shows the link to the session of the interface', function () {
    $admin = User::factory()->admin()->create();
    $invitation = Invitation::factory()->create(['invited_by' => $admin->id]);

    $this->actingAs($admin)->getJson('/api/v1/invitations')->assertOk()->assertJsonPath('data.0.link', InvitationLinks::for($invitation));
});

it('names the state of each invitation, closed when its link no longer works', function () {
    $admin = User::factory()->admin()->create();
    $demoted = User::factory()->admin()->create();
    $open = Invitation::factory()->create(['invited_by' => $admin->id, 'email' => 'open@example.com']);
    $byDemoted = Invitation::factory()->create(['invited_by' => $demoted->id, 'email' => 'demoted@example.com']);
    $taken = Invitation::factory()->create(['invited_by' => $admin->id, 'email' => 'taken@example.com']);
    User::factory()->create(['email' => 'taken@example.com']);
    app(RoleAssignments::class)->setOrgRole($demoted, OrgRole::Member);

    $states = collect($this->actingAs($admin)->getJson('/api/v1/invitations')->assertOk()->assertJsonPath('meta.total', 3)->json('data'))->pluck('state', 'id');

    expect($states->all())->toBe([$open->id => 'open', $byDemoted->id => 'closed', $taken->id => 'closed']);
});

it('wants the projects as a list, each project once', function (Closure $projects, string $field, string $message) {
    app()->setLocale('de');
    $web = Project::factory()->create();

    $this->actingAs(User::factory()->admin()->create())->postJson('/api/v1/invitations', [
        'email' => 'lea@example.com', 'org_role' => 'member', 'projects' => $projects($web),
    ])->assertUnprocessable()->assertJsonValidationErrors([$field => $message]);

    expect(Invitation::query()->exists())->toBeFalse();
})->with([
    'an object with keys' => [fn (Project $web) => ['a' => ['project_id' => $web->id, 'role' => 'member']], 'projects', 'Die Projekte müssen eine Liste sein.'],
    'the same project twice' => [fn (Project $web) => [['project_id' => $web->id, 'role' => 'member'], ['project_id' => $web->id, 'role' => 'viewer']], 'projects.0.project_id', 'Ein Projekt darf nur einmal vorkommen.'],
]);

it('works with a token of an admin and refuses one of a member', function () {
    $admin = User::factory()->admin()->create();
    $member = User::factory()->create();

    $this->withToken(apiToken($admin, ['write']))->postJson('/api/v1/invitations', ['email' => 'lea@example.com', 'org_role' => 'member'])->assertCreated();
    forgetApiAuth();
    $this->withToken(apiToken($admin, ['read']))->getJson('/api/v1/invitations')->assertOk()->assertJsonPath('meta.total', 1);
    forgetApiAuth();
    $this->withToken(apiToken($member, ['read', 'write']))->getJson('/api/v1/invitations')->assertForbidden();
});
