<?php

use App\Access\ProjectRole;
use App\Actions\WorkItems\BulkUpdateWorkItems;
use App\Actions\WorkItems\ChangeWorkItemType;
use App\Actions\WorkItems\CreateWorkItem;
use App\Actions\WorkItems\DeleteWorkItem;
use App\Actions\WorkItems\TransitionWorkItem;
use App\Actions\WorkItems\UpdateWorkItem;
use App\Events\EventType;
use App\Models\Event;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use App\Models\WorkItemType;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

/*
 * Changes of items that lock several item rows (a parent under a shared lock after the own item, a deletion with its
 * children) can deadlock with each other; MariaDB then rolls one of them back. Their transactions run up to three times
 * (`DB::transaction(…, 3)`), and Laravel retries only a concurrency error. Here the first attempt fails with a deadlock
 * as MariaDB reports it, after its event was written; the second attempt must succeed and leave exactly one event.
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

it('retries the transaction after a deadlock', function (Closure $run, EventType $type) use ($deadlockOnce) {
    $mara = User::factory()->create(['name' => 'Mara']);
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $item = WorkItem::factory()->for($web)->create(['created_by' => $mara->id]);
    $thrown = $deadlockOnce();

    $run($mara, $web, $item);

    expect($thrown())->toBe(1)
        ->and(Event::query()->where('type', $type)->count())->toBe(1);
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
]);
