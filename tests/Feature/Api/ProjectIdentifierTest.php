<?php

use App\Actions\Projects\CreateProject;
use App\Actions\Projects\DeleteProject;
use App\Actions\Projects\GetProject;
use App\Actions\Projects\UpdateProject;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Event;
use App\Models\Project;
use App\Models\ProjectIdentifier;
use App\Models\User;
use Illuminate\Validation\ValidationException;

/*
 * Review Focus "Kennungswechsel" (spec 4.4): a former identifier keeps resolving to its project and stays reserved;
 * the project itself may come back to it.
 */

it('keeps the old identifier resolving and reserved after a rename', function () {
    $admin = User::factory()->admin()->create();
    $web = CreateProject::run(actor($admin), ['name' => 'Website', 'identifier' => 'WEB']);
    UpdateProject::run(actor($admin), $web, ['identifier' => 'site']);

    $this->actingAs($admin)->getJson('/api/v1/projects/WEB')->assertOk()->assertJsonPath('data.identifier', 'SITE');
    $this->postJson('/api/v1/projects', ['name' => 'Andere', 'identifier' => 'WEB'])
        ->assertUnprocessable()->assertJsonPath('errors.identifier.0', __('field.identifier.taken'));

    UpdateProject::run(actor($admin), $web->fresh(), ['identifier' => 'WEB']);
    expect(ProjectIdentifier::query()->pluck('identifier')->all())->toBe(['SITE']);
});

it('records the rename and keeps every former identifier through several renames', function () {
    $admin = User::factory()->admin()->create();
    $web = CreateProject::run(actor($admin), ['name' => 'Website', 'identifier' => 'WEB']);
    UpdateProject::run(actor($admin), $web, ['identifier' => 'SITE']);
    UpdateProject::run(actor($admin), $web, ['identifier' => 'PAGE']);

    expect(ProjectIdentifier::query()->orderBy('identifier')->pluck('identifier')->all())->toBe(['SITE', 'WEB'])
        ->and(Event::query()->where('type', EventType::ProjectUpdated)->orderBy('occurred_at')->pluck('changes')->all())->toBe([
            ['identifier' => ['old' => 'WEB', 'new' => 'SITE']],
            ['identifier' => ['old' => 'SITE', 'new' => 'PAGE']],
        ]);

    foreach (['web', 'SITE', 'PAGE', $web->id] as $reference) {
        $this->actingAs($admin)->getJson("/api/v1/projects/{$reference}")->assertOk()->assertJsonPath('data.identifier', 'PAGE');
    }
});

it('does not hand a former identifier of one project to another', function () {
    $admin = User::factory()->admin()->create();
    $web = CreateProject::run(actor($admin), ['name' => 'Website', 'identifier' => 'WEB']);
    $app = CreateProject::run(actor($admin), ['name' => 'App', 'identifier' => 'APP']);
    UpdateProject::run(actor($admin), $web, ['identifier' => 'SITE']);

    // neither the current identifier of another project nor its former one
    foreach (['WEB', 'site'] as $identifier) {
        $this->actingAs($admin)->patchJson("/api/v1/projects/{$app->identifier}", ['identifier' => $identifier])
            ->assertUnprocessable()->assertJsonPath('errors.identifier.0', __('field.identifier.taken'));
    }

    expect($app->fresh()?->identifier)->toBe('APP');
});

it('renames a project read before another rename from what is stored, with the right old values', function () {
    $admin = User::factory()->admin()->create();
    $web = CreateProject::run(actor($admin), ['name' => 'Website', 'identifier' => 'WEB']);
    // read before the first rename, as by a request that runs at the same time
    $stale = Project::query()->findOrFail($web->id);
    UpdateProject::run(actor($admin), $web, ['identifier' => 'SITE', 'name' => 'Seite']);

    expect(UpdateProject::run(actor($admin), $stale, ['identifier' => 'APP', 'name' => 'App'])->identifier)->toBe('APP')
        ->and(ProjectIdentifier::query()->orderBy('identifier')->pluck('identifier')->all())->toBe(['SITE', 'WEB'])
        ->and(Event::query()->where('type', EventType::ProjectUpdated)->orderBy('occurred_at')->pluck('changes')->all())->toBe([
            ['name' => ['old' => 'Website', 'new' => 'Seite'], 'identifier' => ['old' => 'WEB', 'new' => 'SITE']],
            ['name' => ['old' => 'Seite', 'new' => 'App'], 'identifier' => ['old' => 'SITE', 'new' => 'APP']],
        ]);
});

it('changes nothing when the identifier stays, whatever its case', function () {
    $admin = User::factory()->admin()->create();
    $web = CreateProject::run(actor($admin), ['name' => 'Website', 'identifier' => 'WEB']);

    UpdateProject::run(actor($admin), $web, ['identifier' => ' web ']);

    expect(ProjectIdentifier::query()->count())->toBe(0)
        ->and(Event::query()->where('type', EventType::ProjectUpdated)->count())->toBe(0);
});

it('refuses an identifier that does not fit the rule', function (mixed $identifier) {
    $admin = User::factory()->admin()->create();
    $web = CreateProject::run(actor($admin), ['name' => 'Website', 'identifier' => 'WEB']);

    $this->actingAs($admin)->patchJson("/api/v1/projects/{$web->id}", ['identifier' => $identifier])
        ->assertUnprocessable()->assertJsonPath('errors.identifier.0', __('field.identifier.format'));
})->with([['W'], ['1AB'], ['WEB-1'], ['ABCDEFGHIJK'], [''], [null], [['WEB']]]);

it('frees every identifier of a project once it is purged', function () {
    $admin = User::factory()->admin()->create();
    $web = CreateProject::run(actor($admin), ['name' => 'Website', 'identifier' => 'WEB']);
    UpdateProject::run(actor($admin), $web, ['identifier' => 'SITE']);

    // the queue runs synchronously in tests: the purge follows the commit
    DeleteProject::run(actor($admin), $web);

    expect(ProjectIdentifier::query()->count())->toBe(0)
        ->and(CreateProject::run(actor($admin), ['name' => 'Neu', 'identifier' => 'WEB'])->identifier)->toBe('WEB')
        ->and(CreateProject::run(actor($admin), ['name' => 'Auch neu', 'identifier' => 'SITE'])->identifier)->toBe('SITE');
});

it('tells someone without access only that the identifier of a private project is taken', function () {
    $lead = User::factory()->create();
    $ops = CreateProject::run(actor($lead), ['name' => 'Geheimer Betrieb', 'identifier' => 'OPS', 'visibility' => 'private']);
    UpdateProject::run(actor($lead), $ops, ['identifier' => 'RUN']);

    foreach (['RUN', 'OPS'] as $identifier) {
        $response = $this->actingAs(User::factory()->create())->postJson('/api/v1/projects', ['name' => 'Meins', 'identifier' => $identifier])
            ->assertUnprocessable()->assertExactJsonStructure(['type', 'title', 'status', 'detail', 'reason', 'errors' => ['identifier']])
            ->assertJsonPath('errors.identifier', [__('field.identifier.taken')]);

        expect($response->getContent())->not->toContain('Geheimer Betrieb')->not->toContain($ops->id);
    }
});

it('says when a project was asked for by a former identifier', function () {
    $admin = User::factory()->admin()->create();
    $web = CreateProject::run(actor($admin), ['name' => 'Website', 'identifier' => 'WEB']);
    UpdateProject::run(actor($admin), $web, ['identifier' => 'SITE']);

    expect(GetProject::run(actor($admin), 'web'))->resolved_by_former_identifier->toBeTrue()->identifier->toBe('SITE')
        ->and(GetProject::run(actor($admin), 'site'))->resolved_by_former_identifier->toBeFalse()
        ->and(GetProject::run(actor($admin), $web->id))->resolved_by_former_identifier->toBeFalse()
        ->and(GetProject::run(actor($admin), $web->fresh()))->resolved_by_former_identifier->toBeFalse();
});

it('answers an unknown and an invisible reference the same', function () {
    $ops = CreateProject::run(actor(User::factory()->create()), ['name' => 'Betrieb', 'identifier' => 'OPS', 'visibility' => 'private']);
    $outsider = actor(User::factory()->create());

    foreach (['NOPE', 'OPS', $ops->id] as $reference) {
        expect(fn () => GetProject::run($outsider, $reference))->toThrow(fn (Problem $problem) => expect($problem->status)->toBe(404)->and($problem->detail)->toBeNull());
    }

    $this->actingAs($outsider->user)->getJson('/api/v1/projects/NOPE')->assertNotFound()->assertJsonMissingPath('detail');
});

it('reports an invalid identifier on creation as a field error', function () {
    expect(fn () => CreateProject::run(actor(User::factory()->create()), ['name' => 'Website', 'identifier' => 'web-1']))
        ->toThrow(ValidationException::class, __('field.identifier.format'));
});
