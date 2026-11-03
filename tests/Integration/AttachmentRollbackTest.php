<?php

use App\Access\ProjectRole;
use App\Actions\WorkItems\DeleteWorkItem;
use App\Events\EventType;
use App\Models\Attachment;
use App\Models\Comment;
use App\Models\Event;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use Illuminate\Support\Facades\Storage;
use Spatie\MediaLibrary\MediaCollections\Models\Media;

/*
 * Without the test transaction of RefreshDatabase: the files of the attachments go only when the deletion of their item
 * really commits (K12). Here a commit and a rollback are real, so a file removed inside the transaction would be gone.
 */

it('keeps rows and files when deleting an item fails after the attachments', function () {
    Storage::fake('local');
    $mara = User::factory()->create();
    $web = Project::factory()->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $item = WorkItem::factory()->for($web)->create();
    $comment = Comment::factory()->create(['work_item_id' => $item->id, 'author_id' => $mara->id]);
    $stored = fn (string $name) => Attachment::factory()->stored('Inhalt', 'text/plain', $name)->state(['uploaded_by' => $mara->id]);
    $attachments = [
        $stored('bild.png')->forItem($item)->create(),
        $stored('skizze.png')->create(['project_id' => $web->id, 'attachable_type' => $comment->getMorphClass(), 'attachable_id' => $comment->id]),
    ];
    $paths = array_map(fn (Attachment $attachment) => (string) $attachment->getFirstMedia('file')?->getPathRelativeToRoot(), $attachments);
    // the event of the deletion is the last write, after the attachments went
    Event::creating(function (Event $event) {
        if ($event->type === EventType::WorkItemDeleted) {
            throw new RuntimeException('the outbox fails');
        }
    });

    expect(fn () => DeleteWorkItem::run(actor($mara), $item))->toThrow(RuntimeException::class, 'the outbox fails');

    expect(WorkItem::query()->find($item->id))->not->toBeNull()
        ->and(Comment::query()->find($comment->id))->not->toBeNull()
        ->and(Attachment::query()->count())->toBe(2)
        ->and(Media::query()->count())->toBe(2)
        ->and(array_map(fn (string $file) => Storage::disk('local')->exists($file), $paths))->toBe([true, true]);
});

it('removes the files once the deletion commits', function () {
    Storage::fake('local');
    $mara = User::factory()->create();
    $web = Project::factory()->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $item = WorkItem::factory()->for($web)->create();
    $attachment = Attachment::factory()->stored('Inhalt', 'text/plain', 'bild.png')->forItem($item)->create(['uploaded_by' => $mara->id]);
    $file = (string) $attachment->getFirstMedia('file')?->getPathRelativeToRoot();

    DeleteWorkItem::run(actor($mara), $item);

    expect(Attachment::query()->count())->toBe(0)
        ->and(Media::query()->count())->toBe(0)
        ->and(Storage::disk('local')->exists($file))->toBeFalse();
});
