<?php

use App\Access\ProjectRole;
use App\Actions\Comments\AddComment;
use App\Actions\Projects\ArchiveProject;
use App\Actions\WorkItems\CreateWorkItem;
use App\Actions\WorkItems\DeleteWorkItem;
use App\Actions\WorkItems\UpdateWorkItem;
use App\Events\EventType;
use App\Models\Attachment;
use App\Models\Comment;
use App\Models\CommentReaction;
use App\Models\Event;
use App\Models\Label;
use App\Models\Project;
use App\Models\RelationType;
use App\Models\User;
use App\Models\WorkItem;
use App\Models\WorkItemRelation;
use App\Models\WorkItemSubscriber;
use App\Models\WorkItemType;
use App\Models\WorkItemValue;
use App\Support\Actor;
use App\Support\RelationSnapshot;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Spatie\MediaLibrary\MediaCollections\Models\Media;

/** WEB (the default workflow) with Mara as its admin and lead. */
$web = function (): array {
    $mara = User::factory()->create(['name' => 'Mara']);
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);

    return [$web, $mara];
};

it('lets only project admins delete', function () use ($web) {
    [$project, $mara] = $web();
    $member = memberOf($project, ProjectRole::Member);
    $item = WorkItem::factory()->for($project)->create();

    $refused = problemOf(fn () => DeleteWorkItem::run(actor($member), $item));

    expect([$refused->status, $refused->detail])->toBe([403, __('problem.detail.items_delete_admins_only')])
        ->and(WorkItem::query()->find($item->id))->not->toBeNull();

    DeleteWorkItem::run(actor($mara), $item);

    expect(WorkItem::query()->find($item->id))->toBeNull();
});

it('turns the children into items without parent and says so in their history', function () use ($web) {
    [$project, $mara] = $web();
    $epic = WorkItem::factory()->for($project)->epic()->create();
    [$first, $second] = WorkItem::factory()->childOf($epic)->count(2)->create(['updated_at' => '2026-10-01 08:00:00']);
    $other = WorkItem::factory()->for($project)->create(['updated_at' => '2026-10-01 08:00:00']);
    Carbon::setTestNow('2026-11-02 09:30:00');

    DeleteWorkItem::run(actor($mara, Actor::VIA_API), $epic);

    foreach ([$first, $second] as $child) {
        $event = eventsOf(EventType::WorkItemUpdated, $child)->sole();
        expect($child->fresh()?->parent_id)->toBeNull()
            ->and($child->fresh()?->updated_at?->toJSON())->toBe('2026-11-02T09:30:00.000000Z')
            ->and($event->changes)->toBe(['parent_id' => ['old' => $epic->id, 'new' => null]])
            ->and($event->meta)->toMatchArray(['via' => Actor::VIA_API, 'reason' => 'parent_deleted'])
            ->and($event->actor_id)->toBe($mara->id)
            ->and($event->project_id)->toBe($project->id);
    }
    expect($other->fresh()?->updated_at?->toJSON())->toBe('2026-10-01T08:00:00.000000Z')
        ->and(eventsOf(EventType::WorkItemUpdated, $other))->toHaveCount(0)
        ->and(eventsOf(EventType::WorkItemDeleted, $epic)->sole()->meta)->toMatchArray(['via' => Actor::VIA_API, 'reason' => null]);
});

it('records the removed relation at the other end, also in another project', function () use ($web) {
    [$project, $mara] = $web();
    $ops = Project::factory()->identifier('OPS')->private()->member($mara, ProjectRole::Member)->create();
    $item = WorkItem::factory()->for($project)->create();
    $blocked = WorkItem::factory()->for($project)->create(['updated_at' => '2026-10-01 08:00:00']);
    $elsewhere = WorkItem::factory()->for($ops)->create(['updated_at' => '2026-10-01 08:00:00']);
    $blocks = RelationType::query()->where('built_in', 'blocks')->firstOrFail();
    $relates = RelationType::query()->where('built_in', 'relates')->firstOrFail();
    WorkItemRelation::factory()->create(['type_id' => $blocks->id, 'source_id' => $item->id, 'target_id' => $blocked->id]);
    WorkItemRelation::factory()->create(['type_id' => $relates->id, 'source_id' => $elsewhere->id, 'target_id' => $item->id]);
    $untouched = WorkItem::factory()->for($project)->create(['updated_at' => '2026-10-01 08:00:00']);
    $unrelated = WorkItemRelation::factory()->create(['source_id' => $blocked->id, 'target_id' => $untouched->id]);
    Carbon::setTestNow('2026-11-02 09:30:00');

    DeleteWorkItem::run(actor($mara), $item);

    $atBlocked = eventsOf(EventType::WorkItemRelationRemoved, $blocked)->sole();
    $atElsewhere = eventsOf(EventType::WorkItemRelationRemoved, $elsewhere)->sole();
    expect($atBlocked->changes)->toBe(['relation' => [
        'old' => ['relation_type_id' => $blocks->id, 'direction' => 'inward', 'label' => $blocks->inward_label, 'item_id' => $item->id],
        'new' => null,
    ]])
        ->and($atBlocked->project_id)->toBe($project->id)
        ->and($atElsewhere->changes)->toBe(['relation' => [
            'old' => ['relation_type_id' => $relates->id, 'direction' => 'outward', 'label' => $relates->outward_label, 'item_id' => $item->id],
            'new' => null,
        ]])
        ->and($atElsewhere->project_id)->toBe($ops->id)
        ->and($atElsewhere->actor_id)->toBe($mara->id)
        ->and(WorkItemRelation::query()->pluck('id')->all())->toBe([$unrelated->id])
        ->and(Event::query()->where('type', EventType::WorkItemRelationRemoved)->count())->toBe(2)
        // a relation is a change of each end (spec 4.14): both other ends move, the item at the far end of a kept one does not
        ->and($blocked->fresh()?->updated_at?->toJSON())->toBe('2026-11-02T09:30:00.000000Z')
        ->and($elsewhere->fresh()?->updated_at?->toJSON())->toBe('2026-11-02T09:30:00.000000Z')
        ->and($untouched->fresh()?->updated_at?->toJSON())->toBe('2026-10-01T08:00:00.000000Z');
});

it('keeps the events of the deleted item', function () use ($web) {
    [$project, $mara] = $web();
    $item = CreateWorkItem::run(actor($mara), ['project_id' => $project->id, 'title' => 'Formular prüfen']);

    DeleteWorkItem::run(actor($mara), $item);

    $deleted = eventsOf(EventType::WorkItemDeleted, $item)->sole();
    expect(eventsOf(EventType::WorkItemCreated, $item))->toHaveCount(1)
        ->and($deleted->changes)->toBeNull()
        ->and($deleted->meta)->toMatchArray(['key' => 'WEB-1', 'title' => 'Formular prüfen'])
        ->and($deleted->project_id)->toBe($project->id)
        ->and($deleted->actor_id)->toBe($mara->id);
});

it('removes values, labels and subscriptions', function () use ($web) {
    [$project, $mara] = $web();
    $label = Label::factory()->create();
    $bug = WorkItemType::query()->where('name', 'Bug')->firstOrFail();
    $item = CreateWorkItem::run(actor($mara), [
        'project_id' => $project->id, 'type_id' => $bug->id, 'title' => 'Absturz', 'label_ids' => [$label->id], 'values' => ['effort' => 3],
    ]);
    $kept = CreateWorkItem::run(actor($mara), [
        'project_id' => $project->id, 'type_id' => $bug->id, 'title' => 'Bleibt', 'label_ids' => [$label->id], 'values' => ['effort' => 1],
    ]);
    $count = fn (string $table) => DB::table($table)->where('work_item_id', $item->id)->count();
    expect([$count('work_item_values'), $count('work_item_labels'), $count('work_item_subscribers')])->toBe([1, 1, 1]);

    DeleteWorkItem::run(actor($mara), $item);

    expect([$count('work_item_values'), $count('work_item_labels'), $count('work_item_subscribers')])->toBe([0, 0, 0])
        ->and(WorkItemValue::query()->where('work_item_id', $kept->id)->count())->toBe(1)
        ->and(WorkItemSubscriber::query()->where('work_item_id', $kept->id)->count())->toBe(1)
        ->and(Label::query()->find($label->id))->not->toBeNull();
});

it('refuses in an archived project and deletes an archived item', function () use ($web) {
    [$project, $mara] = $web();
    $item = WorkItem::factory()->for($project)->archived()->create();
    $other = Project::factory()->member($mara, ProjectRole::Admin)->create();
    $inArchive = WorkItem::factory()->for($other)->create();
    ArchiveProject::run(actor($mara), $other, true);

    $refused = problemOf(fn () => DeleteWorkItem::run(actor($mara), $inArchive));
    DeleteWorkItem::run(actor($mara), $item);

    expect([$refused->status, $refused->reason])->toBe([409, 'project_archived'])
        ->and(WorkItem::query()->find($inArchive->id))->not->toBeNull()
        ->and(WorkItem::query()->find($item->id))->toBeNull();
});

it('answers 404 for an item deleted after it was read', function () use ($web) {
    [$project, $mara] = $web();
    $item = WorkItem::factory()->for($project)->create();
    $read = WorkItem::query()->findOrFail($item->id);

    DeleteWorkItem::run(actor($mara), $item);
    $refused = problemOf(fn () => DeleteWorkItem::run(actor($mara), $read));

    expect($refused->status)->toBe(404)
        ->and(eventsOf(EventType::WorkItemDeleted))->toHaveCount(1);
});

it('snapshots a relation from either end and refuses an item that is no end', function () use ($web) {
    [$project] = $web();
    $relation = WorkItemRelation::factory()->create();
    $source = WorkItem::query()->findOrFail($relation->source_id);
    $target = WorkItem::query()->findOrFail($relation->target_id);
    $relates = RelationType::query()->where('built_in', 'relates')->firstOrFail();

    expect($relates->inward_label)->toBeNull()
        ->and(RelationSnapshot::of($relation, $target))->toBe(['relation_type_id' => $relates->id, 'direction' => 'inward', 'label' => $relates->outward_label, 'item_id' => $source->id])
        ->and(RelationSnapshot::of($relation, $source)['direction'])->toBe('outward')
        ->and(fn () => RelationSnapshot::of($relation, WorkItem::factory()->for($project)->create()))->toThrow(InvalidArgumentException::class, 'is no end of relation');
});

it('removes the files of the item and of its comments after the commit', function () use ($web) {
    Storage::fake('local');
    [$project, $mara] = $web();
    $item = WorkItem::factory()->for($project)->create();
    $other = WorkItem::factory()->for($project)->create();
    $comment = Comment::factory()->create(['work_item_id' => $item->id, 'author_id' => $mara->id]);
    CommentReaction::query()->create(['comment_id' => $comment->id, 'user_id' => $mara->id, 'emoji' => '👍']);
    $stored = fn (string $name) => Attachment::factory()->stored('Inhalt', 'text/plain', $name)->state(['uploaded_by' => $mara->id]);
    $gone = [
        $stored('bild.png')->forItem($item)->create(),
        $stored('angebot.txt')->forItem($item, 'file')->create(),
        $stored('skizze.png')->create(['project_id' => $project->id, 'attachable_type' => $comment->getMorphClass(), 'attachable_id' => $comment->id]),
    ];
    $kept = [
        $stored('andere.png')->forItem($other)->create(),
        // an upload nobody owns yet is not the item's, even in its project
        $stored('entwurf.png')->create(['project_id' => $project->id]),
    ];
    $path = fn (Attachment $attachment) => (string) $attachment->getFirstMedia('file')?->getPathRelativeToRoot();
    $paths = array_map($path, $gone);
    // the deletion is the last write of the transaction: the files are still there then
    $during = null;
    Event::created(function (Event $event) use (&$during, $paths) {
        if ($event->type === EventType::WorkItemDeleted) {
            $during = array_map(fn (string $file) => Storage::disk('local')->exists($file), $paths);
        }
    });

    DeleteWorkItem::run(actor($mara), $item);

    expect($during)->toBe([true, true, true])
        ->and(array_map(fn (string $file) => Storage::disk('local')->exists($file), $paths))->toBe([false, false, false])
        ->and(Attachment::query()->orderBy('filename')->pluck('filename')->all())->toBe(['andere.png', 'entwurf.png'])
        ->and(Media::query()->pluck('model_id')->sort()->values()->all())->toBe(collect($kept)->pluck('id')->sort()->values()->all())
        ->and(array_map(fn (Attachment $attachment) => Storage::disk('local')->exists($path($attachment)), $kept))->toBe([true, true])
        ->and(Comment::query()->count())->toBe(0)
        ->and(CommentReaction::query()->count())->toBe(0);
});

it('hands a picture another text of the project still shows over to that text instead of removing it', function () use ($web) {
    Storage::fake('local');
    [$project, $mara] = $web();
    $lene = memberOf($project, ProjectRole::Viewer);
    [$a, $b, $c] = WorkItem::factory()->for($project)->count(3)->create()->all();
    $png = (string) base64_decode(explode(',', imageDataUrl())[1]);
    $upload = fn (string $name) => Attachment::factory()->stored($png, 'image/png', $name)->create(['project_id' => $project->id, 'uploaded_by' => $mara->id]);
    [$copied, $own, $twice] = [$upload('kopiert.png'), $upload('eigen.png'), $upload('zweimal.png')];
    $list = Attachment::factory()->forItem($a, 'file')->stored('Angebot', 'text/plain', 'angebot.txt')->create(['uploaded_by' => $mara->id]);
    $path = fn (Attachment $attachment) => (string) $attachment->getFirstMedia('file')?->getPathRelativeToRoot();
    $files = array_map($path, [$copied, $own, $twice, $list]);
    $image = fn (Attachment $attachment) => "![{$attachment->filename}](attachment:{$attachment->id})";
    UpdateWorkItem::run(actor($mara), $a, ['description' => $image($copied)."\n\n".$image($own)."\n\n".$image($twice)]);
    // a comment of A goes with A: it keeps nothing
    AddComment::run(actor($mara), $a, ['body' => $image($own)]);
    // copied into a comment of B, into C's description and another comment of B, and the file of A's list into B's text
    $ofB = AddComment::run(actor($mara), $b, ['body' => $image($copied)]);
    UpdateWorkItem::run(actor($mara), $c, ['description' => $image($twice)]);
    $alsoOfB = AddComment::run(actor($mara), $b, ['body' => $image($twice)]);
    UpdateWorkItem::run(actor($mara), $b, ['description' => "[angebot.txt](attachment:{$list->id})"]);
    $owner = fn (Attachment $attachment) => Attachment::query()->whereKey($attachment->id)->first(['attachable_type', 'attachable_id', 'kind'])?->only(['attachable_type', 'attachable_id', 'kind']);
    $first = strcmp($c->id, $alsoOfB->id) < 0 ? ['work_item', $c->id] : ['comment', $alsoOfB->id];

    DeleteWorkItem::run(actor($mara), $a);

    expect($owner($copied))->toBe(['attachable_type' => 'comment', 'attachable_id' => $ofB->id, 'kind' => 'inline'])
        ->and($owner($own))->toBeNull()
        ->and($owner($twice))->toBe(['attachable_type' => $first[0], 'attachable_id' => $first[1], 'kind' => 'inline'])
        // the file of the list becomes a file of B's text
        ->and($owner($list))->toBe(['attachable_type' => 'work_item', 'attachable_id' => $b->id, 'kind' => 'inline'])
        ->and(array_map(fn (string $file) => Storage::disk('local')->exists($file), $files))->toBe([true, false, true, true])
        ->and(Media::query()->count())->toBe(3);
    $this->actingAs($lene)->getJson("/api/v1/attachments/{$copied->id}")->assertOk()->assertJsonPath('data.owner', ['type' => 'comment', 'id' => $ofB->id]);
    $this->get("/attachments/{$copied->id}")->assertOk();
});
