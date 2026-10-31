<?php

use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Access\Visibility;
use App\Actions\Projects\ArchiveProject;
use App\Actions\Projects\CreateProject;
use App\Actions\Projects\UpdateProject;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Event;
use App\Models\Project;
use App\Models\User;
use Illuminate\Support\Facades\Storage;
use Spatie\MediaLibrary\MediaCollections\Models\Media;

beforeEach(function () {
    Storage::fake('local');
});

/** The shape of `Project` in resources/js/types.ts with `my_role` (P13) and `is_member`. */
const PROJECT_SHAPE = [
    'id', 'identifier', 'name', 'description', 'image_url', 'lead_id', 'visibility', 'workflow_id', 'enabled_type_ids',
    'default_type_id', 'archived_at', 'my_role', 'is_member',
];

it('creates a project whose creator becomes its admin and lead', function () {
    $lene = User::factory()->create();

    $response = $this->actingAs($lene)->postJson('/api/v1/projects', ['name' => ' Website ', 'identifier' => ' web ', 'description' => ' Der Auftritt. '])
        ->assertCreated()->assertJsonStructure(['data' => PROJECT_SHAPE])
        ->assertJsonPath('data.identifier', 'WEB')->assertJsonPath('data.name', 'Website')
        ->assertJsonPath('data.description', 'Der Auftritt.')->assertJsonPath('data.lead_id', $lene->id)
        ->assertJsonPath('data.visibility', 'public')->assertJsonPath('data.my_role', 'admin')
        ->assertJsonPath('data.image_url', null)->assertJsonPath('data.archived_at', null)
        ->assertJsonPath('data.workflow_id', null)->assertJsonPath('data.enabled_type_ids', [])->assertJsonPath('data.default_type_id', null);

    $project = Project::query()->findOrFail($response->json('data.id'));
    $event = eventsOf(EventType::ProjectCreated, $project)[0];

    expect(Visibility::isMember($lene, $project))->toBeTrue()
        ->and(Visibility::roleIn($lene, $project))->toBe(ProjectRole::Admin)
        ->and($event->actor_id)->toBe($lene->id)
        ->and($event->project_id)->toBe($project->id)
        ->and($event->changes)->toBe(['identifier' => ['old' => null, 'new' => 'WEB']]);
});

it('makes another lead a member of the new project', function () {
    $mara = User::factory()->create();
    $lene = User::factory()->create();

    $project = CreateProject::run(actor($mara), ['name' => 'Betrieb', 'identifier' => 'OPS', 'lead_id' => $lene->id, 'visibility' => 'private']);

    expect($project->lead_id)->toBe($lene->id)
        ->and($project->visibility->value)->toBe('private')
        ->and(Visibility::roleIn($mara, $project))->toBe(ProjectRole::Admin)
        ->and(Visibility::roleIn($lene, $project))->toBe(ProjectRole::Member);
});

it('stores the lead in lower case, whatever case it came in', function () {
    $lene = User::factory()->create();

    // the collation would let the upper-case ULID pass as somebody else and make the creator a mere member
    $this->actingAs($lene)->postJson('/api/v1/projects', ['name' => 'Website', 'identifier' => 'WEB', 'lead_id' => strtoupper($lene->id)])
        ->assertCreated()->assertJsonPath('data.lead_id', $lene->id)->assertJsonPath('data.my_role', 'admin');
    $web = Project::query()->sole();

    $this->patchJson('/api/v1/projects/WEB', ['lead_id' => strtoupper($lene->id)])->assertOk()->assertJsonPath('data.lead_id', $lene->id);

    expect($web->lead_id)->toBe($lene->id)
        ->and(Visibility::roleIn($lene, $web))->toBe(ProjectRole::Admin)
        ->and(eventsOf(EventType::ProjectUpdated, $web))->toBeEmpty();
});

it('takes no workflow and no types before Phase 3', function () {
    // pinned so that Phase 3 shows up as a change of this test
    $this->actingAs(User::factory()->create())->postJson('/api/v1/projects', [
        'name' => 'Website', 'identifier' => 'WEB', 'workflow_id' => '01jbworkflowxxxxxxxxxxxxxx', 'enabled_type_ids' => ['t_task'],
        'default_type_id' => 't_task',
    ])->assertCreated()->assertJsonPath('data.workflow_id', null)->assertJsonPath('data.enabled_type_ids', [])
        ->assertJsonPath('data.default_type_id', null);

    expect(Project::query()->sole())->workflow_id->toBeNull()->default_type_id->toBeNull();
});

it('refuses a lead who is no active person', function (Closure $lead) {
    $this->actingAs(User::factory()->create())->postJson('/api/v1/projects', ['name' => 'Website', 'identifier' => 'WEB', 'lead_id' => $lead()])
        ->assertUnprocessable()->assertJsonPath('errors.lead_id.0', __('field.lead.invalid'));
})->with([
    'deactivated' => [fn () => User::factory()->disabled()->create()->id],
    'bot' => [fn () => User::factory()->bot()->create()->id],
    'unknown' => [fn () => '01jbxxxxxxxxxxxxxxxxxxxxxx'],
    'no text' => [fn () => ['x']],
]);

it('refuses a bot as the default lead', function () {
    // a bot creates through the API: it has to name a person as lead
    $this->actingAs(User::factory()->bot()->create())->postJson('/api/v1/projects', ['name' => 'Website', 'identifier' => 'WEB'])
        ->assertUnprocessable()->assertJsonPath('errors.lead_id.0', __('field.lead.invalid'));
});

it('checks the fields of a new project', function (array $input, string $field, string $message) {
    $this->actingAs(User::factory()->create())->postJson('/api/v1/projects', $input + ['name' => 'Website', 'identifier' => 'WEB'])
        ->assertUnprocessable()->assertJsonPath("errors.{$field}.0", __($message, ['max' => $field === 'name' ? 120 : 2000]));
})->with([
    'empty name' => [['name' => '  '], 'name', 'field.name.required'],
    'long name' => [['name' => str_repeat('n', 121)], 'name', 'field.name.max'],
    'name no text' => [['name' => ['x']], 'name', 'field.name.invalid'],
    'long description' => [['description' => str_repeat('d', 2001)], 'description', 'field.description.max'],
    'description no text' => [['description' => 5], 'description', 'field.description.invalid'],
    'invalid identifier' => [['identifier' => 'W'], 'identifier', 'field.identifier.format'],
    'missing identifier' => [['identifier' => null], 'identifier', 'field.identifier.format'],
    'unknown visibility' => [['visibility' => 'secret'], 'visibility', 'field.visibility.unknown'],
    'visibility no text' => [['visibility' => null], 'visibility', 'field.visibility.unknown'],
    'picture no text' => [['image_url' => 5], 'image_url', 'field.image.invalid'],
]);

it('keeps the limits of name and description inclusive', function () {
    $project = CreateProject::run(actor(User::factory()->create()), ['name' => str_repeat('n', 120), 'identifier' => 'WEB', 'description' => str_repeat('d', 2000)]);

    expect(mb_strlen($project->name))->toBe(120)->and(mb_strlen($project->description))->toBe(2000);
});

it('lists the visible projects by name, archived ones only on request', function () {
    $lene = User::factory()->create();
    $mara = User::factory()->create();
    CreateProject::run(actor($mara), ['name' => 'Website', 'identifier' => 'WEB']);
    CreateProject::run(actor($mara), ['name' => 'Betrieb', 'identifier' => 'OPS', 'visibility' => 'private']);
    $old = CreateProject::run(actor($mara), ['name' => 'Altes', 'identifier' => 'OLD']);
    ArchiveProject::run(actor($mara), $old);
    CreateProject::run(actor($lene), ['name' => 'App', 'identifier' => 'APP', 'visibility' => 'private']);

    $this->actingAs($lene)->getJson('/api/v1/projects')->assertOk()
        ->assertJsonStructure(['data' => ['*' => PROJECT_SHAPE], 'links', 'meta' => ['path', 'per_page', 'next_cursor', 'prev_cursor', 'total']])
        ->assertJsonPath('meta.total', 2)
        ->assertJsonPath('data.*.identifier', ['APP', 'WEB']);

    $this->getJson('/api/v1/projects?include_archived=1')->assertOk()
        ->assertJsonPath('data.*.identifier', ['OLD', 'APP', 'WEB'])
        ->assertJsonPath('data.0.archived_at', $old->archived_at?->toJSON());

    $this->getJson('/api/v1/projects?include_archived=0')->assertOk()->assertJsonPath('meta.total', 2);
});

it('pages through the projects with every one exactly once', function () {
    $admin = User::factory()->admin()->create();
    Project::factory()->count(5)->create();
    $this->actingAs($admin);

    $seen = [];
    $url = '/api/v1/projects?per_page=2';

    while ($url !== null) {
        $response = $this->getJson($url)->assertOk()->assertJsonPath('meta.total', 5);
        array_push($seen, ...$response->json('data'));
        $cursor = $response->json('meta.next_cursor');
        $url = $cursor === null ? null : "/api/v1/projects?per_page=2&cursor={$cursor}";
    }

    expect(array_column($seen, 'name'))->toBe(Project::query()->orderBy('name')->orderBy('id')->pluck('name')->all());
});

it('refuses an include_archived that is no flag', function () {
    $this->actingAs(User::factory()->create())->getJson('/api/v1/projects?include_archived=maybe')
        ->assertUnprocessable()->assertJsonPath('errors.include_archived.0', __('field.include_archived.invalid'));
});

it('names the role of the account in each project', function () {
    $lead = User::factory()->create();
    $web = Project::factory()->identifier('WEB')->public()->create(['lead_id' => $lead->id]);
    $viewer = memberOf($web, ProjectRole::Viewer);

    $role = fn (User $user) => $this->actingAs($user)->getJson('/api/v1/projects/WEB')->assertOk()->json('data.my_role');

    expect($role(User::factory()->admin()->create()))->toBe('admin')
        ->and($role($viewer))->toBe('viewer')
        ->and($role(memberOf($web, ProjectRole::Member)))->toBe('member')
        // a public project without a membership: read as a viewer
        ->and($role(User::factory()->create()))->toBe('viewer');
});

it('says whether the account is a member, which the role alone does not', function () {
    $lead = User::factory()->create();
    $web = Project::factory()->identifier('WEB')->public()->create(['lead_id' => $lead->id]);
    $viewer = memberOf($web, ProjectRole::Viewer);
    $admin = User::factory()->admin()->create();

    $member = fn (User $user) => $this->actingAs($user)->getJson('/api/v1/projects/WEB')->assertOk()->json('data.is_member');

    // a viewer by membership and a viewer by visibility read the same role
    expect($member($viewer))->toBeTrue()
        ->and($member(User::factory()->create()))->toBeFalse()
        // an org admin is an admin everywhere, member or not
        ->and($member($admin))->toBeFalse();

    app(RoleAssignments::class)->setProjectRole($admin, $web, ProjectRole::Member);
    Visibility::forget();
    expect($member($admin))->toBeTrue()
        ->and($this->actingAs($admin)->getJson('/api/v1/projects')->json('data.0.is_member'))->toBeTrue();
});

it('hides a private project from those who are not members', function () {
    $ops = Project::factory()->identifier('OPS')->private()->create();
    Project::factory()->identifier('WEB')->public()->create();
    $outsider = User::factory()->create();

    $this->actingAs($outsider)->getJson('/api/v1/projects/OPS')->assertNotFound()->assertJsonMissingPath('detail');
    $this->getJson("/api/v1/projects/{$ops->id}")->assertNotFound();
    $this->patchJson('/api/v1/projects/OPS', ['name' => 'Neu'])->assertNotFound()->assertJsonMissingPath('detail');
    $this->postJson('/api/v1/projects/OPS/archive')->assertNotFound();
    $this->getJson('/api/v1/projects')->assertOk()->assertJsonPath('data.*.identifier', ['WEB']);
});

it('sees a change of visibility in the next call', function () {
    $admin = User::factory()->admin()->create();
    CreateProject::run(actor($admin), ['name' => 'Betrieb', 'identifier' => 'OPS', 'visibility' => 'private']);
    $outsider = User::factory()->create();

    // the visible projects of an account are kept for the request, and in a test across calls (P33)
    $this->actingAs($outsider)->getJson('/api/v1/projects/OPS')->assertNotFound();
    $this->getJson('/api/v1/projects')->assertJsonPath('meta.total', 0);
    $this->actingAs($admin)->patchJson('/api/v1/projects/OPS', ['visibility' => 'public'])->assertOk()->assertJsonPath('data.visibility', 'public');
    $this->actingAs($outsider)->getJson('/api/v1/projects/OPS')->assertOk()->assertJsonPath('data.my_role', 'viewer');
    $this->getJson('/api/v1/projects')->assertJsonPath('data.*.identifier', ['OPS']);

    $this->actingAs($admin)->deleteJson('/api/v1/projects/OPS')->assertStatus(202);
    $this->actingAs($outsider)->getJson('/api/v1/projects/OPS')->assertNotFound();
    $this->getJson('/api/v1/projects')->assertJsonPath('meta.total', 0);
});

it('lets only admins of the project change its settings', function () {
    $web = Project::factory()->identifier('WEB')->public()->create();
    $member = memberOf($web, ProjectRole::Member);

    $this->actingAs($member)->patchJson('/api/v1/projects/WEB', ['name' => 'Neu'])
        ->assertForbidden()->assertJsonPath('detail', __('problem.detail.project_settings_admins'));
    $this->postJson('/api/v1/projects/WEB/archive')->assertForbidden()->assertJsonPath('detail', __('problem.detail.project_archive_admins'));
    $this->postJson('/api/v1/projects/WEB/restore')->assertForbidden()->assertJsonPath('detail', __('problem.detail.project_archive_admins'));
    $this->deleteJson('/api/v1/projects/WEB')->assertForbidden()->assertJsonPath('detail', __('problem.detail.project_delete_admins'));

    expect($web->fresh())->name->toBe($web->name)->archived_at->toBeNull()->deleting_at->toBeNull();
});

it('changes the settings and records only what changed', function () {
    $mara = User::factory()->create();
    $web = CreateProject::run(actor($mara), ['name' => 'Website', 'identifier' => 'WEB', 'description' => 'Alt']);
    $lene = memberOf($web, ProjectRole::Viewer);

    $this->actingAs($mara)->patchJson('/api/v1/projects/WEB', [
        'name' => ' Webseite ', 'description' => null, 'visibility' => 'private', 'lead_id' => $lene->id,
    ])->assertOk()->assertJsonPath('data.name', 'Webseite')->assertJsonPath('data.description', '')
        ->assertJsonPath('data.visibility', 'private')->assertJsonPath('data.lead_id', $lene->id);

    // the same again changes nothing
    UpdateProject::run(actor($mara), $web->fresh(), ['name' => 'Webseite', 'visibility' => 'private']);

    expect(eventsOf(EventType::ProjectUpdated, $web)->map(fn (Event $event) => $event->changes)->all())->toBe([[
        'name' => ['old' => 'Website', 'new' => 'Webseite'],
        'description' => ['old' => 'Alt', 'new' => ''],
        'visibility' => ['old' => 'public', 'new' => 'private'],
        'lead_id' => ['old' => $mara->id, 'new' => $lene->id],
    ]]);
});

it('checks the fields of a change', function (array $input, string $field, string $message) {
    $admin = User::factory()->admin()->create();
    CreateProject::run(actor($admin), ['name' => 'Website', 'identifier' => 'WEB']);

    $this->actingAs($admin)->patchJson('/api/v1/projects/WEB', $input)
        ->assertUnprocessable()->assertJsonPath("errors.{$field}.0", __($message, ['max' => $field === 'name' ? 120 : 2000]));
})->with([
    'empty name' => [['name' => ''], 'name', 'field.name.required'],
    'long name' => [['name' => str_repeat('n', 121)], 'name', 'field.name.max'],
    'long description' => [['description' => str_repeat('d', 2001)], 'description', 'field.description.max'],
    'unknown visibility' => [['visibility' => 'secret'], 'visibility', 'field.visibility.unknown'],
    'no lead' => [['lead_id' => null], 'lead_id', 'field.lead.invalid'],
]);

it('takes only a member as lead', function () {
    $admin = User::factory()->admin()->create();
    CreateProject::run(actor($admin), ['name' => 'Website', 'identifier' => 'WEB']);

    $this->actingAs($admin)->patchJson('/api/v1/projects/WEB', ['lead_id' => User::factory()->create()->id])
        ->assertUnprocessable()->assertJsonPath('errors.lead_id.0', __('field.lead.not_member'));
});

it('takes no deactivated member and no bot as lead', function (Closure $make) {
    $admin = User::factory()->admin()->create();
    $web = CreateProject::run(actor($admin), ['name' => 'Website', 'identifier' => 'WEB']);

    $this->actingAs($admin)->patchJson('/api/v1/projects/WEB', ['lead_id' => $make($web)->id])
        ->assertUnprocessable()->assertJsonPath('errors.lead_id.0', __('field.lead.invalid'));
})->with([
    'deactivated' => [fn (Project $web) => memberOf($web, ProjectRole::Member, ['disabled_at' => now()])],
    'bot' => [fn (Project $web) => tap(User::factory()->bot()->create(), fn (User $bot) => app(RoleAssignments::class)->setProjectRole($bot, $web, ProjectRole::Member))],
]);

it('keeps an archived project manageable for its admins', function () {
    $admin = User::factory()->admin()->create();
    $web = CreateProject::run(actor($admin), ['name' => 'Website', 'identifier' => 'WEB']);
    ArchiveProject::run(actor($admin), $web);

    $this->actingAs($admin)->patchJson('/api/v1/projects/WEB', ['name' => 'Webseite'])->assertOk()->assertJsonPath('data.name', 'Webseite');
});

it('archives and restores a project, recording each only when it changes', function () {
    $admin = User::factory()->admin()->create();
    $web = CreateProject::run(actor($admin), ['name' => 'Website', 'identifier' => 'WEB']);

    $archivedAt = $this->actingAs($admin)->postJson('/api/v1/projects/WEB/archive')->assertOk()->json('data.archived_at');
    $this->postJson('/api/v1/projects/WEB/archive')->assertOk()->assertJsonPath('data.archived_at', $archivedAt);
    $this->getJson('/api/v1/projects')->assertJsonPath('meta.total', 0);

    $this->postJson('/api/v1/projects/WEB/restore')->assertOk()->assertJsonPath('data.archived_at', null);
    $this->postJson('/api/v1/projects/WEB/restore')->assertOk();
    $this->getJson('/api/v1/projects')->assertJsonPath('meta.total', 1);

    $archived = eventsOf(EventType::ProjectArchived, $web);
    $restored = eventsOf(EventType::ProjectRestored, $web);

    expect($archivedAt)->not->toBeNull()
        ->and($archived)->toHaveCount(1)->and($restored)->toHaveCount(1)
        ->and($archived[0]->changes)->toBe(['archived_at' => ['old' => null, 'new' => $archivedAt]])
        ->and($restored[0]->changes)->toBe(['archived_at' => ['old' => $archivedAt, 'new' => null]])
        ->and(EventType::ProjectRestored->webhook())->toBeTrue();
});

it('sets, replaces and removes the picture of a project', function () {
    $admin = User::factory()->admin()->create();

    $created = $this->actingAs($admin)->postJson('/api/v1/projects', ['name' => 'Website', 'identifier' => 'WEB', 'image_url' => imageDataUrl()])
        ->assertCreated()->json('data.image_url');
    $first = Media::query()->sole();

    expect($created)->toBe(route('media.show', $first->uuid))->and($first->collection_name)->toBe('image');

    // the current URL sent back changes nothing
    $this->patchJson('/api/v1/projects/WEB', ['image_url' => $created])->assertOk()->assertJsonPath('data.image_url', $created);
    $replaced = $this->patchJson('/api/v1/projects/WEB', ['image_url' => imageDataUrl('webp')])->assertOk()->json('data.image_url');
    $this->patchJson('/api/v1/projects/WEB', ['image_url' => null])->assertOk()->assertJsonPath('data.image_url', null);

    $web = Project::query()->sole();
    expect($replaced)->not->toBe($created)
        ->and(Media::query()->count())->toBe(0)
        ->and(eventsOf(EventType::ProjectUpdated, $web)->map(fn (Event $event) => array_keys($event->changes ?? []))->all())
        ->toBe([['image_url'], ['image_url']]);
});

it('refuses a picture that is no image', function () {
    $admin = User::factory()->admin()->create();
    CreateProject::run(actor($admin), ['name' => 'Website', 'identifier' => 'WEB']);

    $this->actingAs($admin)->patchJson('/api/v1/projects/WEB', ['image_url' => 'data:image/svg+xml;base64,PHN2Zy8+'])
        ->assertUnprocessable()->assertJsonValidationErrorFor('image_url');
});

it('lets a disabled account create nothing', function () {
    expect(fn () => CreateProject::run(actor(User::factory()->disabled()->create()), ['name' => 'Website', 'identifier' => 'WEB']))
        ->toThrow(fn (Problem $problem) => expect($problem->status)->toBe(403));
});
