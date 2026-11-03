<?php

use App\Access\ProjectRole;
use App\Actions\Attachments\DeleteAttachment;
use App\Actions\Attachments\UploadAttachment;
use App\Events\EventType;
use App\Models\Attachment;
use App\Models\Event;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use App\Support\AttachmentFiles;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Spatie\MediaLibrary\MediaCollections\Models\Media;

beforeEach(function () {
    Storage::fake('local');
});

/** A file of the file list of the item, uploaded by the person (through the action: event and all). */
$file = fn (User $user, WorkItem $item, string $name = 'angebot.txt') => UploadAttachment::run(
    actor($user),
    ['project_id' => $item->project_id, 'kind' => 'file', 'work_item_id' => $item->id],
    UploadedFile::fake()->createWithContent($name, 'Angebot'),
);

/** An upload into a text nobody owns yet. */
$unowned = fn (User $user, Project $project) => UploadAttachment::run(
    actor($user),
    ['project_id' => $project->id, 'kind' => 'inline'],
    UploadedFile::fake()->createWithContent('skizze.png', (string) base64_decode(explode(',', imageDataUrl())[1])),
);

$path = fn (Attachment $attachment) => (string) $attachment->getFirstMedia('file')?->getPathRelativeToRoot();

it('deletes a file of the list with an event and removes the file after the commit', function () use ($file, $path) {
    $project = Project::factory()->identifier('WEB')->create();
    $mara = memberOf($project, ProjectRole::Member);
    $item = WorkItem::factory()->state(['project_id' => $project->id])->create();
    $attachment = $file($mara, $item);
    $stored = $path($attachment);
    Carbon::setTestNow(now()->addMinutes(5)->startOfSecond());
    // the event is the last write of the transaction: the file is still there then
    $during = null;
    Event::created(function () use (&$during, $stored) {
        $during = Storage::disk('local')->exists($stored);
    });

    $this->actingAs($mara)->deleteJson("/api/v1/attachments/{$attachment->id}")->assertNoContent();

    $event = eventsOf(EventType::WorkItemUpdated, $item)->last();
    expect($during)->toBeTrue()
        ->and(Storage::disk('local')->exists($stored))->toBeFalse()
        ->and(Storage::disk('local')->allFiles())->toBe([])
        ->and(Attachment::query()->count())->toBe(0)
        ->and(Media::query()->count())->toBe(0)
        ->and($event->actor_id)->toBe($mara->id)
        ->and($event->project_id)->toBe($project->id)
        ->and($event->changes)->toBe(['attachments' => ['old' => ['id' => $attachment->id, 'filename' => 'angebot.txt'], 'new' => null]])
        ->and(eventsOf(EventType::WorkItemUpdated, $item))->toHaveCount(2)
        ->and($item->fresh()?->updated_at?->toJSON())->toBe(now()->toJSON());
});

it('keeps row and file when the transaction rolls back', function () use ($file, $path) {
    $project = Project::factory()->create();
    $mara = memberOf($project, ProjectRole::Member);
    $item = WorkItem::factory()->state(['project_id' => $project->id])->create();
    $attachment = $file($mara, $item);
    $stored = $path($attachment);
    Event::creating(fn () => throw new RuntimeException('the outbox fails'));

    expect(fn () => DeleteAttachment::run(actor($mara), $attachment))->toThrow(RuntimeException::class, 'the outbox fails');

    expect(Attachment::query()->sole()->id)->toBe($attachment->id)
        ->and(Media::query()->count())->toBe(1)
        ->and(Storage::disk('local')->exists($stored))->toBeTrue();
});

it('lets the uploader delete an unowned upload, nobody else (404)', function () use ($unowned, $path) {
    $project = Project::factory()->create();
    $mara = memberOf($project, ProjectRole::Member);
    $attachment = $unowned($mara, $project);
    $stored = $path($attachment);
    $events = Event::query()->count();

    foreach ([memberOf($project, ProjectRole::Admin), User::factory()->admin()->create()] as $other) {
        $this->actingAs($other)->deleteJson("/api/v1/attachments/{$attachment->id}")->assertNotFound()->assertJsonMissingPath('detail');
    }
    expect(Storage::disk('local')->exists($stored))->toBeTrue();

    $this->actingAs($mara)->deleteJson("/api/v1/attachments/{$attachment->id}")->assertNoContent();

    expect(Attachment::query()->count())->toBe(0)
        ->and(Media::query()->count())->toBe(0)
        ->and(Storage::disk('local')->allFiles())->toBe([])
        ->and(Event::query()->count())->toBe($events);
});

it('refuses an image of a text with 409 attachment_inline', function () use ($path) {
    $project = Project::factory()->create();
    $admin = memberOf($project, ProjectRole::Admin);
    $item = WorkItem::factory()->state(['project_id' => $project->id])->create();
    $image = Attachment::factory()->forItem($item)->stored((string) base64_decode(explode(',', imageDataUrl())[1]), 'image/png', 'bild.png')->create();

    $this->actingAs($admin)->deleteJson("/api/v1/attachments/{$image->id}")->assertConflict()
        ->assertJsonPath('reason', 'attachment_inline')
        ->assertJsonPath('detail', __('problem.detail.attachment_inline'));

    expect(Attachment::query()->sole()->id)->toBe($image->id)
        ->and(Storage::disk('local')->exists($path($image)))->toBeTrue()
        ->and(eventsOf(EventType::WorkItemUpdated, $item))->toHaveCount(0);
});

it('refuses a viewer with 403 and hides the file from an outsider', function () use ($file) {
    $project = Project::factory()->identifier('WEB')->public()->create();
    $mara = memberOf($project, ProjectRole::Member);
    $item = WorkItem::factory()->state(['project_id' => $project->id])->create();
    $attachment = $file($mara, $item);
    $ops = Project::factory()->identifier('OPS')->private()->create();
    $hidden = $file(memberOf($ops, ProjectRole::Member), WorkItem::factory()->state(['project_id' => $ops->id])->create());

    $this->actingAs(memberOf($project, ProjectRole::Viewer))->deleteJson("/api/v1/attachments/{$attachment->id}")->assertForbidden()
        ->assertJsonPath('detail', __('problem.detail.items_members_only'));
    $this->actingAs($mara)->deleteJson("/api/v1/attachments/{$hidden->id}")->assertNotFound()->assertJsonMissingPath('detail');

    expect(Attachment::query()->count())->toBe(2);
});

it('refuses an archived project and an archived item with 409', function () use ($file) {
    $project = Project::factory()->identifier('WEB')->create();
    $admin = memberOf($project, ProjectRole::Admin);
    $open = WorkItem::factory()->state(['project_id' => $project->id])->create();
    $done = WorkItem::factory()->state(['project_id' => $project->id])->closed()->create();
    $first = $file($admin, $open);
    $second = $file($admin, $done);
    $done->forceFill(['archived_at' => now()])->save();

    $this->actingAs($admin)->deleteJson("/api/v1/attachments/{$second->id}")->assertConflict()
        ->assertJsonPath('reason', 'archived')->assertJsonPath('detail', __('problem.detail.item_archived', ['key' => $done->key]));
    $project->forceFill(['archived_at' => now()])->save();
    $this->actingAs($admin)->deleteJson("/api/v1/attachments/{$first->id}")->assertConflict()->assertJsonPath('reason', 'project_archived');

    expect(Attachment::query()->count())->toBe(2);
});

it('reads the row afresh under the lock: gone is a 404 without event, linked meanwhile is a picture of a text', function () use ($file, $unowned) {
    $project = Project::factory()->create();
    $mara = memberOf($project, ProjectRole::Member);
    $item = WorkItem::factory()->state(['project_id' => $project->id])->create();
    $attachment = $file($mara, $item);
    $upload = $unowned($mara, $project);
    // another request deleted the file and linked the upload to a text after this one read them (K13)
    Attachment::query()->whereKey($attachment->id)->delete();
    Attachment::query()->whereKey($upload->id)->update(['attachable_type' => $item->getMorphClass(), 'attachable_id' => $item->id]);

    expect(problemOf(fn () => DeleteAttachment::run(actor($mara), $attachment))->status)->toBe(404)
        ->and(problemOf(fn () => DeleteAttachment::run(actor($mara), $upload))->reason)->toBe('attachment_inline')
        ->and(eventsOf(EventType::WorkItemUpdated, $item))->toHaveCount(1)
        ->and(Attachment::query()->sole()->id)->toBe($upload->id);
});

it('removes the media rows at once and the files of all of them after the commit', function () use ($unowned, $path) {
    $project = Project::factory()->create();
    $mara = memberOf($project, ProjectRole::Member);
    $first = $unowned($mara, $project);
    $second = $unowned($mara, $project);
    $kept = $unowned($mara, $project);
    $paths = [$path($first), $path($second)];

    DB::transaction(function () use ($first, $second, $paths) {
        AttachmentFiles::removeAfterCommit(collect([$first, $second]));

        expect(Media::query()->where('model_id', $first->id)->exists())->toBeFalse()
            ->and(Storage::disk('local')->exists($paths[0]))->toBeTrue()
            ->and(Storage::disk('local')->exists($paths[1]))->toBeTrue();
    });

    expect(Storage::disk('local')->exists($paths[0]))->toBeFalse()
        ->and(Storage::disk('local')->exists($paths[1]))->toBeFalse()
        ->and(Storage::disk('local')->exists($path($kept)))->toBeTrue()
        ->and(Media::query()->sole()->model_id)->toBe($kept->id)
        // the rows of the attachments are the caller's
        ->and(Attachment::query()->count())->toBe(3);
});

it('hands a file of the list that another text names over to that text instead of deleting it (I1)', function () use ($file, $path) {
    $project = Project::factory()->identifier('WEB')->create();
    $mara = memberOf($project, ProjectRole::Member);
    $item = WorkItem::factory()->state(['project_id' => $project->id])->create();
    $other = WorkItem::factory()->state(['project_id' => $project->id])->create(['created_by' => $mara->id]);
    $attachment = $file($mara, $item);
    $stored = $path($attachment);
    $this->actingAs($mara)->patchJson("/api/v1/work-items/{$other->key}", ['description' => "[Angebot](attachment:{$attachment->id})"])->assertOk();

    $this->actingAs($mara)->deleteJson("/api/v1/attachments/{$attachment->id}")->assertNoContent();

    // the file leaves the list (the event says so) and stays as a file of the text that names it
    expect($attachment->fresh()?->only(['attachable_type', 'attachable_id', 'kind']))->toBe(['attachable_type' => 'work_item', 'attachable_id' => $other->id, 'kind' => 'inline'])
        ->and(Storage::disk('local')->exists($stored))->toBeTrue()
        ->and(eventsOf(EventType::WorkItemUpdated, $item)->last()?->changes)->toBe(['attachments' => ['old' => ['id' => $attachment->id, 'filename' => 'angebot.txt'], 'new' => null]]);
    $this->actingAs($mara)->get("/attachments/{$attachment->id}")->assertOk();
    $description = $other->fresh()?->description;
    $this->actingAs($mara)->patchJson("/api/v1/work-items/{$other->key}", ['description_json' => $description, 'title' => 'Neu'])->assertOk();
});

it('takes no dead picture or file the text had before as a reason to refuse saving it', function () {
    $project = Project::factory()->identifier('WEB')->create();
    $mara = memberOf($project, ProjectRole::Member);
    $item = WorkItem::factory()->state(['project_id' => $project->id])->create(['created_by' => $mara->id]);
    $picture = Attachment::factory()->forItem($item)->create(['uploaded_by' => $mara->id]);
    $document = Attachment::factory()->forItem($item)->create(['uploaded_by' => $mara->id, 'filename' => 'plan.pdf']);
    $this->actingAs($mara)->patchJson("/api/v1/work-items/{$item->key}", ['description' => "Plan ![](attachment:{$picture->id}) [plan.pdf](attachment:{$document->id})"])->assertOk();
    // gone without the text knowing (an older version deleted it, a row removed by hand)
    Attachment::query()->whereKey([$picture->id, $document->id])->delete();

    $this->actingAs($mara)->patchJson("/api/v1/work-items/{$item->key}", ['description_json' => $item->fresh()?->description, 'title' => 'Neu'])
        ->assertOk()->assertJsonPath('data.description', 'Plan');
    // alone in a quote, a dead picture leaves an empty paragraph: no refused shape, the text is empty then (T4-M5)
    $quoted = Attachment::factory()->forItem($item)->create(['uploaded_by' => $mara->id]);
    $this->actingAs($mara)->patchJson("/api/v1/work-items/{$item->key}", ['description' => "> ![](attachment:{$quoted->id})"])->assertOk();
    Attachment::query()->whereKey($quoted->id)->delete();
    $this->actingAs($mara)->patchJson("/api/v1/work-items/{$item->key}", ['description_json' => $item->fresh()?->description, 'title' => 'Zitat'])
        ->assertOk()->assertJsonPath('data.title', 'Zitat')->assertJsonPath('data.description_json', null);
    // a dead attachment the text did not have before stays a 422
    $this->actingAs($mara)->patchJson("/api/v1/work-items/{$item->key}", ['description' => "![](attachment:{$picture->id})"])
        ->assertUnprocessable()->assertJsonPath('errors.description', [__('field.rich_text.attachment')]);
});
