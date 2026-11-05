<?php

use App\Access\ProjectRole;
use App\Actions\Attachments\UploadAttachment;
use App\Actions\WorkItems\AddRelation;
use App\Actions\WorkItems\BulkUpdateWorkItems;
use App\Actions\WorkItems\ChangeWorkItemType;
use App\Actions\WorkItems\CreateWorkItem;
use App\Actions\WorkItems\DeleteWorkItem;
use App\Actions\WorkItems\RemoveRelation;
use App\Actions\WorkItems\TransitionWorkItem;
use App\Actions\WorkItems\UpdateWorkItem;
use App\Domain\Automations\AutomationKey;
use App\Events\EventType;
use App\Models\Attachment;
use App\Models\Automation;
use App\Models\Event;
use App\Models\Project;
use App\Models\RelationType;
use App\Models\User;
use App\Models\WorkItem;
use App\Models\WorkItemRelation;
use App\Models\WorkItemType;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Database\QueryException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Spatie\MediaLibrary\MediaCollections\Models\Media;

/*
 * Changes of items that lock several item rows (a parent under a shared lock after the own item, a deletion with its
 * children, both ends of a relation) can deadlock with each other; MariaDB then rolls one of them back. Their transactions run up to three times
 * (`DB::transaction(…, 3)`), and Laravel retries only a concurrency error. Here the first attempt fails with a deadlock
 * as MariaDB reports it, after its event was written; the second attempt must succeed and leave exactly its events (one,
 * or one at each end of a relation).
 * Without the test transaction of the feature tests (a nested transaction is never retried), so in Integration.
 */

/**
 * Makes the first event written on the default connection fail like a deadlock; answers how often it did.
 *
 * @return Closure(): int
 */
$deadlockOnce = function (): Closure {
    $thrown = 0;
    DB::listen(function (QueryExecuted $query) use (&$thrown) {
        if ($thrown === 0 && str_starts_with($query->sql, 'insert into `events`')) {
            $thrown++;
            throw new QueryException($query->connectionName, $query->sql, $query->bindings, new PDOException('SQLSTATE[40001]: Serialization failure: 1213 Deadlock found when trying to get lock; try restarting transaction'));
        }
    });

    return function () use (&$thrown): int {
        return $thrown;
    };
};

it('retries the transaction after a deadlock', function (Closure $run, EventType $type, int $events = 1) use ($deadlockOnce) {
    $mara = User::factory()->create(['name' => 'Mara']);
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $item = WorkItem::factory()->for($web)->create(['created_by' => $mara->id]);
    $thrown = $deadlockOnce();

    $run($mara, $web, $item);

    expect($thrown())->toBe(1)
        ->and(Event::query()->where('type', $type)->count())->toBe($events);
})->with([
    'create' => [fn (User $mara, Project $web) => CreateWorkItem::run(actor($mara), ['project_id' => $web->id, 'title' => 'Neu']), EventType::WorkItemCreated],
    'update' => [fn (User $mara, Project $web, WorkItem $item) => UpdateWorkItem::run(actor($mara), $item, ['title' => 'Neu']), EventType::WorkItemUpdated],
    'transition' => [fn (User $mara, Project $web, WorkItem $item) => TransitionWorkItem::run(actor($mara), $item, [
        'to_state_id' => $web->workflow()->firstOrFail()->states()->where('name', 'In Progress')->value('id'),
    ]), EventType::WorkItemStateChanged],
    'change type' => [fn (User $mara, Project $web, WorkItem $item) => ChangeWorkItemType::run(actor($mara), $item, [
        'type_id' => WorkItemType::query()->where('name', 'Bug')->value('id'),
    ]), EventType::WorkItemUpdated],
    'bulk' => [fn (User $mara, Project $web, WorkItem $item) => expect(BulkUpdateWorkItems::run(actor($mara), ['ids' => [$item->id], 'patch' => ['priority' => 'high']]))
        ->toBe(['updated' => [$item->id], 'rejected' => []]), EventType::WorkItemUpdated],
    'delete' => [fn (User $mara, Project $web, WorkItem $item) => DeleteWorkItem::run(actor($mara), $item), EventType::WorkItemDeleted],
    'relate' => [fn (User $mara, Project $web, WorkItem $item) => AddRelation::run(actor($mara), $item, [
        'type_id' => RelationType::query()->where('built_in', 'relates')->value('id'),
        'target_id' => WorkItem::factory()->for($web)->create()->id,
    ]), EventType::WorkItemRelationAdded, 2],
    'unrelate' => [fn (User $mara, Project $web, WorkItem $item) => RemoveRelation::run(actor($mara), WorkItemRelation::factory()->create([
        'source_id' => $item->id,
        'target_id' => WorkItem::factory()->for($web)->create()->id,
    ])), EventType::WorkItemRelationRemoved, 2],
]);

it('retries an upload after a deadlock: one row, one file, nothing left of the first attempt (T6-M1)', function () use ($deadlockOnce) {
    Storage::fake('local');
    $mara = User::factory()->create(['name' => 'Mara']);
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $item = WorkItem::factory()->for($web)->create(['created_by' => $mara->id]);
    $thrown = $deadlockOnce();

    $attachment = UploadAttachment::run(actor($mara), ['project_id' => $web->id, 'kind' => 'file', 'work_item_id' => $item->id], UploadedFile::fake()->createWithContent('angebot.txt', 'Angebot'));

    expect($thrown())->toBe(1)
        ->and(Attachment::query()->pluck('id')->all())->toBe([$attachment->id])
        ->and(Media::query()->count())->toBe(1)
        ->and(Storage::disk('local')->allFiles())->toBe([(string) $attachment->getFirstMedia('file')?->getPathRelativeToRoot()])
        ->and(Event::query()->where('type', EventType::WorkItemUpdated)->count())->toBe(1);
});

it('retries a move after a deadlock on the parent that Eltern schließen locks (K25)', function () {
    $mara = User::factory()->create(['name' => 'Mara']);
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    Automation::factory()->for($web)->key(AutomationKey::CloseParent)->enabled()->create();
    $epic = WorkItem::factory()->for($web)->epic()->create(['created_by' => $mara->id]);
    $child = WorkItem::factory()->childOf($epic)->create(['created_by' => $mara->id]);
    $done = $web->workflow()->firstOrFail()->states()->where('name', 'Done')->value('id');
    $thrown = 0;
    // the lock of the parent fails once, as MariaDB reports a deadlock with another move of a child of the epic
    DB::listen(function (QueryExecuted $query) use (&$thrown, $epic) {
        if ($thrown === 0 && str_starts_with($query->sql, 'select * from `work_items`') && str_ends_with($query->sql, 'for update') && in_array($epic->id, $query->bindings, true)) {
            $thrown++;
            throw new QueryException($query->connectionName, $query->sql, $query->bindings, new PDOException('SQLSTATE[40001]: Serialization failure: 1213 Deadlock found when trying to get lock; try restarting transaction'));
        }
    });

    TransitionWorkItem::run(actor($mara), $child, ['to_state_id' => $done]);

    expect($thrown)->toBe(1)
        ->and($epic->fresh()?->state_id)->toBe($done)
        ->and(Event::query()->where('type', EventType::WorkItemStateChanged)->pluck('subject_id')->all())->toBe([$child->id, $epic->id]);
});
