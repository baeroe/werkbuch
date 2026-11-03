<?php

use App\Access\ProjectRole;
use App\Actions\Attachments\DeleteAttachment;
use App\Actions\WorkItems\DeleteWorkItem;
use App\Actions\WorkItems\UpdateWorkItem;
use App\Exceptions\Problem;
use App\Models\Attachment;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Tests\Support\RaceConnections;
use Tests\Support\RichTextFixtures as F;

/*
 * Saving a text that names an upload while its uploader deletes it (Task 8, carry from the review of Task 7): the
 * rules of saving read the row before the locks and let the image through, AttachmentLinks reads it again `for update`
 * after the item's lock. The text waits for the deletion and then finds the upload gone: the same 422 as an unknown
 * one, no description pointing to nothing. `mariadb` holds the deletion open like a request in progress,
 * `mariadb_second` is the save and gives up waiting for a lock after one second.
 */

beforeEach(fn () => RaceConnections::setUp());

afterEach(fn () => RaceConnections::tearDown());

it('makes a text wait for the deletion of its upload and refuses it then', function () {
    $mara = User::factory()->create();
    $web = Project::factory()->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $item = WorkItem::factory()->for($web)->create(['created_by' => $mara->id]);
    $upload = Attachment::factory()->create(['project_id' => $web->id, 'uploaded_by' => $mara->id]);
    $save = fn () => UpdateWorkItem::run(actor($mara), WorkItem::query()->findOrFail($item->id), ['description_json' => F::doc(F::image($upload->id, 'Plan'))]);

    RaceConnections::hold(fn () => DeleteAttachment::run(actor($mara), $upload));

    RaceConnections::expectLockWait(RaceConnections::second($save), 'attachments');

    RaceConnections::releaseBeforeLock('attachments');
    $outcome = RaceConnections::second($save);

    expect($outcome)->toBeInstanceOf(ValidationException::class)
        ->and($outcome instanceof ValidationException ? $outcome->errors() : null)->toBe(['description_json' => [__('field.rich_text.attachment')]])
        ->and($item->fresh()?->description)->toBeNull()
        ->and(Attachment::query()->count())->toBe(0);
});

it('makes the deletion of an upload wait for a text that links it, and refuses it then (T7-M3, K13)', function () {
    $mara = User::factory()->create();
    $web = Project::factory()->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $item = WorkItem::factory()->for($web)->create(['created_by' => $mara->id]);
    $upload = Attachment::factory()->create(['project_id' => $web->id, 'uploaded_by' => $mara->id]);
    $delete = fn () => DeleteAttachment::run(actor($mara), Attachment::query()->findOrFail($upload->id));

    RaceConnections::hold(fn () => UpdateWorkItem::run(actor($mara), $item, ['description_json' => F::doc(F::image($upload->id, 'Plan'))]));

    // the row lock of the deletion, not only its fresh read: it waits for the text
    RaceConnections::expectLockWait(RaceConnections::second($delete), 'attachments');

    RaceConnections::releaseBeforeLock('attachments');
    $outcome = RaceConnections::second($delete);

    expect($outcome)->toBeInstanceOf(Problem::class)
        ->and($outcome instanceof Problem ? $outcome->reason : null)->toBe('attachment_inline')
        ->and($upload->fresh()?->attachable_id)->toBe($item->id);
});

it('hands a picture over to a text that names it anew while its item is deleted (T13-M8)', function () {
    $mara = User::factory()->create();
    $web = Project::factory()->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $first = WorkItem::factory()->for($web)->create(['created_by' => $mara->id]);
    $second = WorkItem::factory()->for($web)->create(['created_by' => $mara->id]);
    $picture = Attachment::factory()->forItem($first)->create(['uploaded_by' => $mara->id]);
    $delete = fn () => DeleteWorkItem::run(actor($mara), WorkItem::query()->findOrFail($first->id));

    // the second item's description names the first one's picture (A233), still uncommitted
    RaceConnections::hold(fn () => UpdateWorkItem::run(actor($mara), $second, ['description_json' => F::doc(F::image($picture->id, 'Plan'))]));

    // the deletion waits for the picture's row, and reads the texts only then
    RaceConnections::expectLockWait(RaceConnections::second($delete), 'attachments');

    RaceConnections::releaseBeforeLock('attachments');
    $outcome = RaceConnections::second($delete);

    expect($outcome)->toBeNull()
        ->and(WorkItem::query()->find($first->id))->toBeNull()
        ->and($picture->fresh()?->only(['attachable_id', 'kind']))->toBe(['attachable_id' => $second->id, 'kind' => 'inline']);
});

it('lets a save in another project go on while a deletion hands attachments over (N1)', function () {
    $mara = User::factory()->create();
    $web = Project::factory()->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $ops = Project::factory()->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $first = WorkItem::factory()->for($web)->create(['created_by' => $mara->id]);
    WorkItem::factory()->for($web)->create(['created_by' => $mara->id, 'description' => F::doc(F::p('Nennt nichts'))]);
    Attachment::factory()->forItem($first)->create(['uploaded_by' => $mara->id]);
    $elsewhere = WorkItem::factory()->for($ops)->create(['created_by' => $mara->id]);

    // the deletion has read the texts and stays open, like a request in progress
    RaceConnections::hold(fn () => DeleteWorkItem::run(actor($mara), $first));

    $saved = RaceConnections::second(fn () => UpdateWorkItem::run(actor($mara), WorkItem::query()->findOrFail($elsewhere->id), ['title' => 'Anderswo gespeichert']));

    // read on the second connection: the first one still holds its open deletion
    expect($saved)->toBeInstanceOf(WorkItem::class)
        ->and(DB::connection('mariadb_second')->table('work_items')->where('id', $elsewhere->id)->value('title'))->toBe('Anderswo gespeichert');
});

it('lets two deletions with attachments in one project both go through (N1)', function () {
    $mara = User::factory()->create();
    $web = Project::factory()->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $first = WorkItem::factory()->for($web)->create(['created_by' => $mara->id]);
    $second = WorkItem::factory()->for($web)->create(['created_by' => $mara->id]);
    WorkItem::factory()->for($web)->create(['created_by' => $mara->id, 'description' => F::doc(F::p('Nennt nichts'))]);
    Attachment::factory()->forItem($first)->create(['uploaded_by' => $mara->id]);
    Attachment::factory()->forItem($second)->create(['uploaded_by' => $mara->id]);

    RaceConnections::hold(fn () => DeleteWorkItem::run(actor($mara), $first));
    // the second deletion needs no lock the first one holds
    $outcome = RaceConnections::second(fn () => DeleteWorkItem::run(actor($mara), WorkItem::query()->findOrFail($second->id)));
    RaceConnections::release();

    expect($outcome)->toBeNull()
        // READ COMMITTED was the deletion's only: the session is back on its level
        ->and(DB::connection('mariadb_second')->scalar('select @@session.transaction_isolation'))->toBe('REPEATABLE-READ')
        ->and(WorkItem::query()->whereKey([$first->id, $second->id])->count())->toBe(0)
        ->and(Attachment::query()->count())->toBe(0);
});
