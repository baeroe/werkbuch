<?php

use App\Access\ProjectRole;
use App\Actions\Comments\AddComment;
use App\Actions\Comments\DeleteComment;
use App\Actions\WorkItems\UpdateWorkItem;
use App\Events\EventType;
use App\Models\Attachment;
use App\Models\Comment;
use App\Models\CommentReaction;
use App\Models\Event;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use Illuminate\Support\Facades\Storage;
use Spatie\MediaLibrary\MediaCollections\Models\Media;

/*
 * Deleting a comment (Task 9, A241): its author, the admins of the project and org admins; the event keeps no text
 * (A228); its attachments go, their files only after the commit (K12). WEB (public) with Mara as its admin, Jonas as a
 * member and Lene as a viewer.
 */

beforeEach(function () {
    Storage::fake('local');
});

$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara']);
    $web = Project::factory()->identifier('WEB')->public()->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $jonas = memberOf($web, ProjectRole::Member, ['name' => 'Jonas']);
    $lene = memberOf($web, ProjectRole::Viewer, ['name' => 'Lene']);
    $item = WorkItem::factory()->for($web)->create(['created_by' => $mara->id]);

    return compact('mara', 'web', 'jonas', 'lene', 'item');
};

$delete = fn (User $user, Comment $comment) => DeleteComment::run(actor($user), $comment);

it('lets the author and project admins delete, not a member (403)', function () use ($world, $delete) {
    $w = $world();
    $own = AddComment::run(actor($w['lene']), $w['item'], ['body' => 'Meins.']);
    $byAdmin = AddComment::run(actor($w['lene']), $w['item'], ['body' => 'Löscht Mara.']);
    $byOrgAdmin = AddComment::run(actor($w['lene']), $w['item'], ['body' => 'Löscht der Org-Admin.']);
    $kept = AddComment::run(actor($w['lene']), $w['item'], ['body' => 'Bleibt.']);

    $refused = problemOf(fn () => $delete($w['jonas'], $kept));
    $delete($w['lene'], $own);
    $delete($w['mara'], $byAdmin);
    $delete(User::factory()->admin()->create(), $byOrgAdmin);

    expect($refused->getStatusCode())->toBe(403)
        ->and($refused->detail)->toBe(__('problem.detail.comment_delete_admins_only'))
        ->and(Comment::query()->pluck('id')->all())->toBe([$kept->id])
        // an outsider of the public project reads it, and is refused like a member
        ->and(problemOf(fn () => $delete(User::factory()->create(), $kept))->getStatusCode())->toBe(403);
});

it('hides the comment of a private project from an outsider (404)', function () use ($delete) {
    $ops = Project::factory()->private()->create();
    $comment = Comment::factory()->for(WorkItem::factory()->for($ops), 'workItem')->create();

    expect(problemOf(fn () => $delete(User::factory()->create(), $comment))->getStatusCode())->toBe(404)
        ->and(Comment::query()->count())->toBe(1);
});

it('removes the comment\'s attachments after the commit', function () use ($world, $delete) {
    $w = $world();
    $png = (string) base64_decode(explode(',', imageDataUrl())[1]);
    $upload = Attachment::factory()->stored($png, 'image/png', 'skizze.png')->create(['project_id' => $w['web']->id, 'uploaded_by' => $w['lene']->id]);
    $other = Attachment::factory()->forItem($w['item'])->stored($png, 'image/png', 'bleibt.png')->create();
    $comment = AddComment::run(actor($w['lene']), $w['item'], ['body' => "![Skizze](attachment:{$upload->id})"]);
    $stored = (string) $upload->getFirstMedia('file')?->getPathRelativeToRoot();
    // the event is the last write of the transaction: the file is still there then
    $during = null;
    Event::created(function () use (&$during, $stored) {
        $during = Storage::disk('local')->exists($stored);
    });

    $delete($w['lene'], $comment);

    expect($during)->toBeTrue()
        ->and(Storage::disk('local')->exists($stored))->toBeFalse()
        ->and(Attachment::query()->pluck('id')->all())->toBe([$other->id])
        ->and(Media::query()->count())->toBe(1);
});

it('hands a picture the description or another comment still shows over to that text', function () use ($world, $delete) {
    $w = $world();
    $png = (string) base64_decode(explode(',', imageDataUrl())[1]);
    $upload = fn (string $name) => Attachment::factory()->stored($png, 'image/png', $name)->create(['project_id' => $w['web']->id, 'uploaded_by' => $w['lene']->id]);
    [$described, $answered] = [$upload('beschrieben.png'), $upload('beantwortet.png')];
    $comment = AddComment::run(actor($w['lene']), $w['item'], ['body' => "![a](attachment:{$described->id})\n\n![b](attachment:{$answered->id})"]);
    UpdateWorkItem::run(actor($w['mara']), $w['item'], ['description' => "![a](attachment:{$described->id})"]);
    $answer = AddComment::run(actor($w['jonas']), $w['item'], ['body' => "![b](attachment:{$answered->id})"]);
    $files = array_map(fn (Attachment $attachment) => (string) $attachment->getFirstMedia('file')?->getPathRelativeToRoot(), [$described, $answered]);

    $delete($w['lene'], $comment);

    expect(Attachment::query()->orderBy('filename')->get(['filename', 'attachable_type', 'attachable_id'])->toArray())->toBe([
        ['filename' => 'beantwortet.png', 'attachable_type' => 'comment', 'attachable_id' => $answer->id],
        ['filename' => 'beschrieben.png', 'attachable_type' => 'work_item', 'attachable_id' => $w['item']->id],
    ])
        ->and(array_map(fn (string $file) => Storage::disk('local')->exists($file), $files))->toBe([true, true])
        ->and(Media::query()->count())->toBe(2);
});

it('keeps comment and files when the transaction rolls back', function () use ($world, $delete) {
    $w = $world();
    $png = (string) base64_decode(explode(',', imageDataUrl())[1]);
    $upload = Attachment::factory()->stored($png, 'image/png', 'skizze.png')->create(['project_id' => $w['web']->id, 'uploaded_by' => $w['lene']->id]);
    $comment = AddComment::run(actor($w['lene']), $w['item'], ['body' => "![Skizze](attachment:{$upload->id})"]);
    $stored = (string) $upload->getFirstMedia('file')?->getPathRelativeToRoot();
    Event::creating(fn () => throw new RuntimeException('the outbox fails'));

    expect(fn () => $delete($w['lene'], $comment))->toThrow(RuntimeException::class, 'the outbox fails');

    expect(Comment::query()->count())->toBe(1)
        ->and(Attachment::query()->count())->toBe(1)
        ->and(Media::query()->count())->toBe(1)
        ->and(Storage::disk('local')->exists($stored))->toBeTrue();
});

it('records comment.deleted without the text', function () use ($world, $delete) {
    $w = $world();
    $comment = AddComment::run(actor($w['lene']), $w['item'], ['body' => 'Geheimes Passwort: hunter2']);
    CommentReaction::query()->create(['comment_id' => $comment->id, 'user_id' => $w['jonas']->id, 'emoji' => '👍']);

    $delete($w['mara'], $comment);

    $event = eventsOf(EventType::CommentDeleted, $w['item'])->sole();
    expect($event->actor_id)->toBe($w['mara']->id)
        ->and($event->project_id)->toBe($w['web']->id)
        ->and($event->changes)->toBeNull()
        ->and($event->meta)->toMatchArray(['comment_id' => $comment->id, 'author_id' => $w['lene']->id])
        ->and(json_encode($event->meta))->not->toContain('hunter2')
        // the reactions go with the comment
        ->and(CommentReaction::query()->count())->toBe(0);
});

it('refuses an archived item and an archived project with 409', function () use ($world, $delete) {
    $w = $world();
    $comment = AddComment::run(actor($w['lene']), $w['item'], ['body' => 'Text.']);

    $w['item']->forceFill(['archived_at' => now()])->save();
    $item = problemOf(fn () => $delete($w['lene'], $comment));
    $w['item']->forceFill(['archived_at' => null])->save();
    $w['web']->update(['archived_at' => now()]);
    $project = problemOf(fn () => $delete($w['lene'], $comment));

    expect($item->getStatusCode())->toBe(409)->and($item->reason)->toBe('archived')
        ->and($project->getStatusCode())->toBe(409)->and($project->reason)->toBe('project_archived')
        ->and(Comment::query()->count())->toBe(1);
});

it('answers 404 for a comment deleted meanwhile, without a second event', function () use ($world, $delete) {
    $w = $world();
    $comment = AddComment::run(actor($w['lene']), $w['item'], ['body' => 'Text.']);
    $delete($w['lene'], $comment);

    expect(problemOf(fn () => $delete($w['lene'], $comment))->getStatusCode())->toBe(404)
        ->and(eventsOf(EventType::CommentDeleted))->toHaveCount(1);
});
