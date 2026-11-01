<?php

use App\Access\ProjectRole;
use App\Actions\WorkItems\BulkUpdateWorkItems;
use App\Domain\WorkItems\Priority;
use App\Events\EventType;
use App\Models\Event;
use App\Models\Label;
use App\Models\Project;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkItem;
use Database\Seeders\Demo\CatalogSeeder;
use Illuminate\Support\Str;

/** WEB (the default workflow, free) with Mara as its admin and lead. */
$web = function (): array {
    $mara = User::factory()->create(['name' => 'Mara']);
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);

    return [$web, $mara];
};

/** The id of the state of that name in the workflow of the project. */
$state = fn (Project $project, string $name): string => (string) $project->workflow()->firstOrFail()->states()->where('name', $name)->value('id');

/** @param  list<string>  $ids */
$bulk = fn (User $user, array $ids, mixed $patch): array => BulkUpdateWorkItems::run(actor($user), ['ids' => $ids, 'patch' => $patch]);

/** The labels of the item, sorted. */
$labelsOf = function (WorkItem $item): array {
    $ids = $item->labels()->pluck('labels.id')->all();
    sort($ids);

    return $ids;
};

it('changes every item by its own rules and names the refusals', function () use ($web, $state, $bulk) {
    [$web, $mara] = $web();
    $this->seed(CatalogSeeder::class);
    $agency = Project::factory()->identifier('APP')->member($mara, ProjectRole::Admin)
        ->create(['lead_id' => $mara->id, 'workflow_id' => Workflow::query()->where('name', 'Agentur-Freigabe')->value('id')]);
    $todo = WorkItem::factory()->for($agency)->inState('Todo')->create();
    [$first, $second] = WorkItem::factory()->for($web)->count(2)->create();
    $other = WorkItem::factory()->for($agency)->inState('Todo')->create();

    $result = $bulk($mara, ['app-1', $first->id, strtoupper($second->id)], ['state_id' => $state($web, 'Done')]);
    $allowed = $bulk($mara, [$other->key], ['state_id' => $state($agency, 'In Progress')]);

    expect($result)->toBe([
        'updated' => [$first->id, $second->id],
        'rejected' => [['id' => 'app-1', 'reason' => 'validation_failed']],
    ])
        ->and($first->fresh()?->state_id)->toBe($state($web, 'Done'))
        ->and($second->fresh()?->state_id)->toBe($state($web, 'Done'))
        ->and($todo->fresh()?->state_id)->toBe($state($agency, 'Todo'))
        ->and($allowed)->toBe(['updated' => [$other->id], 'rejected' => []])
        ->and($other->fresh()?->state_id)->toBe($state($agency, 'In Progress'));
});

it('names transition_not_allowed per item', function () use ($bulk) {
    $mara = User::factory()->create();
    // Backlog → Done only
    $workflow = Workflow::factory()->matrix([[0, 2]])->create();
    $project = Project::factory()->identifier('MX')->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id, 'workflow_id' => $workflow->id]);
    $backlog = WorkItem::factory()->for($project)->inState('Backlog')->create();
    $doing = WorkItem::factory()->for($project)->inState('Doing')->create();
    $done = (string) $workflow->states()->where('name', 'Done')->value('id');

    $result = $bulk($mara, [$backlog->key, $doing->key], ['state_id' => $done]);

    expect($result)->toBe(['updated' => [$backlog->id], 'rejected' => [['id' => 'MX-2', 'reason' => 'transition_not_allowed']]])
        ->and($backlog->fresh()?->state_id)->toBe($done)
        ->and($doing->fresh()?->state_id)->not->toBe($done);
});

it('archives only closed items, also after the patch closed them', function () use ($web, $state, $bulk) {
    [$project, $mara] = $web();
    $closed = WorkItem::factory()->for($project)->closed()->create();
    $open = WorkItem::factory()->for($project)->inState('In Progress')->create();
    $closing = WorkItem::factory()->for($project)->inState('In Progress')->create();

    $archive = $bulk($mara, [$closed->id, $open->id], ['archived' => true]);
    $closeAndArchive = $bulk($mara, [$closing->id], ['state_id' => $state($project, 'Done'), 'archived' => true]);
    $events = Event::query()->where('subject_id', $closing->id)->orderBy('occurred_at')->orderBy('id')->pluck('type')->all();

    expect($archive)->toBe(['updated' => [$closed->id], 'rejected' => [['id' => $open->id, 'reason' => 'not_closed']]])
        ->and($closed->fresh()?->archived_at)->not->toBeNull()
        ->and($open->fresh()?->archived_at)->toBeNull()
        ->and($closeAndArchive)->toBe(['updated' => [$closing->id], 'rejected' => []])
        ->and($closing->fresh()?->archived_at)->not->toBeNull()
        ->and($closing->fresh()?->state_id)->toBe($state($project, 'Done'))
        // moved first, archived after
        ->and($events)->toBe([EventType::WorkItemStateChanged, EventType::WorkItemArchived]);
});

it('refuses an archived item unless the patch restores it (K9)', function () use ($web, $bulk) {
    [$project, $mara] = $web();
    $archived = WorkItem::factory()->for($project)->archived()->create(['priority' => Priority::Low]);

    $changed = $bulk($mara, [$archived->key], ['priority' => 'high']);
    $again = $bulk($mara, [$archived->key], ['archived' => true]);

    expect($changed)->toBe(['updated' => [], 'rejected' => [['id' => 'WEB-1', 'reason' => 'archived']]])
        ->and($again)->toBe(['updated' => [], 'rejected' => [['id' => 'WEB-1', 'reason' => 'archived']]])
        ->and($archived->fresh()?->priority)->toBe(Priority::Low)
        ->and($archived->fresh()?->archived_at?->toJSON())->toBe($archived->archived_at?->toJSON())
        ->and(Event::query()->where('subject_id', $archived->id)->count())->toBe(0);
});

it('restores before changing and keeps a refused item archived', function () use ($web, $bulk) {
    [$project, $mara] = $web();
    $restored = WorkItem::factory()->for($project)->archived()->create(['priority' => Priority::Low]);
    $refused = WorkItem::factory()->for($project)->archived()->create(['priority' => Priority::Low]);
    $open = WorkItem::factory()->for($project)->create();

    $result = $bulk($mara, [$restored->id], ['archived' => false, 'priority' => 'high']);
    $kept = $bulk($mara, [$refused->id, $open->id], ['archived' => false, 'label_ids' => [strtolower((string) Str::ulid())]]);
    $events = Event::query()->where('subject_id', $restored->id)->orderBy('occurred_at')->orderBy('id')->pluck('type')->all();

    expect($result)->toBe(['updated' => [$restored->id], 'rejected' => []])
        ->and($restored->fresh()?->archived_at)->toBeNull()
        ->and($restored->fresh()?->priority)->toBe(Priority::High)
        ->and($events)->toBe([EventType::WorkItemRestored, EventType::WorkItemUpdated])
        ->and($kept)->toBe(['updated' => [], 'rejected' => [
            ['id' => $refused->id, 'reason' => 'validation_failed'],
            ['id' => $open->id, 'reason' => 'not_archived'],
        ]])
        ->and($refused->fresh()?->archived_at?->toJSON())->toBe($refused->archived_at?->toJSON())
        ->and(Event::query()->where('subject_id', $refused->id)->count())->toBe(0);
});

it('adds and removes labels', function () use ($web, $bulk, $labelsOf) {
    [$project, $mara] = $web();
    [$a, $b, $c] = Label::factory()->count(3)->create()->sortBy('id')->values()->all();
    [$tagged, $other, $replaced] = WorkItem::factory()->for($project)->count(3)->create(['updated_at' => now()->subDay()]);
    $tagged->labels()->sync([$a->id, $b->id]);
    $other->labels()->sync([$c->id]);

    $result = $bulk($mara, [$tagged->id, $other->id], ['add_label_ids' => [strtoupper($c->id)], 'remove_label_ids' => [strtoupper($a->id)]]);
    $base = $bulk($mara, [$replaced->id], ['label_ids' => [$a->id, $c->id], 'add_label_ids' => [$b->id], 'remove_label_ids' => [$a->id]]);
    $cleared = $bulk($mara, [$replaced->id], ['label_ids' => null, 'add_label_ids' => null, 'remove_label_ids' => null]);
    // a base that is no list is the field error of `label_ids`, per item
    $broken = $bulk($mara, [$tagged->id], ['label_ids' => 'x', 'add_label_ids' => [$a->id]]);

    expect($result)->toBe(['updated' => [$tagged->id, $other->id], 'rejected' => []])
        ->and($labelsOf($tagged))->toBe([$b->id, $c->id])
        // nothing to add and nothing to remove: unchanged, no event
        ->and($labelsOf($other))->toBe([$c->id])
        ->and($other->fresh()?->updated_at?->isYesterday())->toBeTrue()
        ->and(eventsOf(EventType::WorkItemUpdated, $other))->toHaveCount(0)
        ->and(eventsOf(EventType::WorkItemUpdated, $tagged)->sole()->changes)->toBe(['label_ids' => ['old' => [$a->id, $b->id], 'new' => [$b->id, $c->id]]])
        ->and($base)->toBe(['updated' => [$replaced->id], 'rejected' => []])
        ->and($cleared)->toBe(['updated' => [$replaced->id], 'rejected' => []])
        ->and($broken)->toBe(['updated' => [], 'rejected' => [['id' => $tagged->id, 'reason' => 'validation_failed']]])
        ->and(eventsOf(EventType::WorkItemUpdated, $replaced)->pluck('changes')->all())->toBe([
            ['label_ids' => ['old' => [], 'new' => [$b->id, $c->id]]],
            ['label_ids' => ['old' => [$b->id, $c->id], 'new' => []]],
        ]);
});

it('refuses forbidden and invisible items one by one', function () use ($web, $bulk) {
    [$web, $mara] = $web();
    $lene = memberOf($web, ProjectRole::Viewer, ['name' => 'Lene']);
    $ida = memberOf($web, ProjectRole::Member, ['name' => 'Ida']);
    $ops = Project::factory()->identifier('OPS')->private()->member($ida, ProjectRole::Member)->create();
    $old = Project::factory()->identifier('OLD')->member($ida, ProjectRole::Member)->create(['archived_at' => now()]);
    $item = WorkItem::factory()->for($web)->create();
    $secret = WorkItem::factory()->for($ops)->create();
    $archived = WorkItem::factory()->for($old)->create();

    $unknown = strtolower((string) Str::ulid());

    $viewer = $bulk($lene, ['web-1', 'ops-1', 'WEB-99', $unknown], ['priority' => 'high']);
    $member = $bulk($ida, ['WEB-1', 'OPS-1', 'OLD-1'], ['priority' => 'high']);
    $outsider = $bulk($mara, ['OPS-1', $secret->id], ['priority' => 'high']);

    expect($viewer)->toBe(['updated' => [], 'rejected' => [
        ['id' => 'web-1', 'reason' => 'forbidden'],
        ['id' => 'ops-1', 'reason' => 'not_found'],
        ['id' => 'WEB-99', 'reason' => 'not_found'],
        ['id' => $unknown, 'reason' => 'not_found'],
    ]])
        ->and($member)->toBe(['updated' => [$item->id, $secret->id], 'rejected' => [['id' => 'OLD-1', 'reason' => 'project_archived']]])
        ->and($archived->fresh()?->priority)->toBe(Priority::None)
        // the same item twice (key and ULID) is one refusal, under the reference sent first
        ->and($outsider)->toBe(['updated' => [], 'rejected' => [['id' => 'OPS-1', 'reason' => 'not_found']]]);
});

it('leaves a refused item as it was', function () use ($bulk) {
    $mara = User::factory()->create();
    $ida = User::factory()->create();
    // Backlog → Done only
    $workflow = Workflow::factory()->matrix([[0, 2]])->create();
    $project = Project::factory()->identifier('MX')->member($mara, ProjectRole::Admin)->member($ida, ProjectRole::Member)
        ->create(['lead_id' => $mara->id, 'workflow_id' => $workflow->id]);
    $doing = WorkItem::factory()->for($project)->inState('Doing')->create(['priority' => Priority::Low, 'updated_at' => now()->subDay()]);

    $result = $bulk($mara, [$doing->id], [
        'priority' => 'urgent', 'assignee_id' => $ida->id, 'due_date' => '2026-12-01',
        'state_id' => $workflow->states()->where('name', 'Done')->value('id'),
    ]);
    $fresh = $doing->fresh();

    expect($result)->toBe(['updated' => [], 'rejected' => [['id' => $doing->id, 'reason' => 'transition_not_allowed']]])
        ->and([$fresh?->priority, $fresh?->assignee_id, $fresh?->due_date])->toBe([Priority::Low, null, null])
        ->and($fresh?->updated_at?->isYesterday())->toBeTrue()
        ->and(Event::query()->where('subject_id', $doing->id)->count())->toBe(0);
});

it('refuses more than 100 ids and a malformed patch before changing anything', function () use ($web) {
    [$project, $mara] = $web();
    $item = WorkItem::factory()->for($project)->create();
    $ulid = fn (): string => strtolower((string) Str::ulid());
    $many = array_map(fn () => $ulid(), range(1, 101));
    $ids = [__('field.ids.invalid', ['max' => 100])];
    $patch = [__('field.patch.invalid', ['keys' => implode(', ', BulkUpdateWorkItems::PATCH_KEYS)])];
    $refuse = fn (mixed $ids, mixed $patch) => invalidOf(fn () => BulkUpdateWorkItems::run(actor($mara), ['ids' => $ids, 'patch' => $patch]));

    expect($refuse($many, ['priority' => 'high']))->toBe(['ids' => $ids])
        ->and($refuse([], ['priority' => 'high']))->toBe(['ids' => $ids])
        ->and($refuse('WEB-1', ['priority' => 'high']))->toBe(['ids' => $ids])
        ->and($refuse(['a' => 'WEB-1'], ['priority' => 'high']))->toBe(['ids' => $ids])
        ->and($refuse([['WEB-1']], ['priority' => 'high']))->toBe(['ids' => $ids])
        ->and($refuse(['WEB-1', 'Formular'], ['priority' => 'high']))->toBe(['ids' => $ids])
        ->and(invalidOf(fn () => BulkUpdateWorkItems::run(actor($mara), [])))->toBe(['ids' => $ids, 'patch' => $patch])
        ->and($refuse(['WEB-1'], 'high'))->toBe(['patch' => $patch])
        ->and($refuse(['WEB-1'], []))->toBe(['patch' => $patch])
        ->and($refuse(['WEB-1'], ['high']))->toBe(['patch' => $patch])
        ->and($refuse(['WEB-1'], ['priority' => 'high', 'title' => 'Neu']))->toBe(['patch' => $patch])
        // no rich text in a bulk edit: neither the description nor values
        ->and($refuse(['WEB-1'], ['description' => '**fett**']))->toBe(['patch' => $patch])
        ->and($refuse(['WEB-1'], ['description_json' => ['type' => 'doc', 'content' => []]]))->toBe(['patch' => $patch])
        ->and($refuse(['WEB-1'], ['values' => ['notes' => '_Wichtig_']]))->toBe(['patch' => $patch])
        ->and($refuse(['WEB-1'], ['archived' => 'yes']))->toBe(['patch.archived' => [__('field.boolean')]])
        ->and($refuse(['WEB-1'], ['archived' => null]))->toBe(['patch.archived' => [__('field.boolean')]])
        ->and($refuse(['WEB-1'], ['add_label_ids' => [$ulid()], 'remove_label_ids' => 'x']))->toBe([
            'patch.add_label_ids' => [__('field.label_ids.unknown')],
            'patch.remove_label_ids' => [__('field.label_ids.unknown')],
        ])
        ->and($refuse(['WEB-1'], ['add_label_ids' => ['x'], 'remove_label_ids' => [['x']]]))->toBe([
            'patch.add_label_ids' => [__('field.label_ids.unknown')],
            'patch.remove_label_ids' => [__('field.label_ids.unknown')],
        ])
        ->and($refuse(['WEB-1'], ['add_label_ids' => ['a' => Label::factory()->create()->id]]))->toBe(['patch.add_label_ids' => [__('field.label_ids.unknown')]])
        ->and($item->fresh()?->priority)->toBe(Priority::None)
        ->and(Event::query()->where('subject_id', $item->id)->count())->toBe(0);
});

it('takes 100 ids, merges duplicates and answers each item once', function () use ($web, $bulk) {
    [$project, $mara] = $web();
    $item = WorkItem::factory()->for($project)->create();
    $unknown = array_map(fn () => strtolower((string) Str::ulid()), range(1, 97));

    // 101 references, 100 after merging `web-01` into `WEB-1`; the ULID of WEB-1 is the same item again
    $result = $bulk($mara, ['WEB-1', ...$unknown, 'web-01', strtoupper($item->id), 'WEB-2'], ['priority' => 'high']);

    expect($result['updated'])->toBe([$item->id])
        ->and($result['rejected'])->toHaveCount(98)
        ->and(array_column($result['rejected'], 'id'))->toBe([...$unknown, 'WEB-2'])
        ->and(eventsOf(EventType::WorkItemUpdated, $item))->toHaveCount(1);
});

it('records an event per changed item and none for refused ones', function () use ($web, $state, $bulk) {
    [$project, $mara] = $web();
    [$first, $second] = WorkItem::factory()->for($project)->count(2)->create();
    $same = WorkItem::factory()->for($project)->create(['priority' => Priority::High, 'updated_at' => now()->subDay()]);
    $archived = WorkItem::factory()->for($project)->archived()->create();

    $result = $bulk($mara, [$first->id, $second->id, $same->id, $archived->id], ['priority' => 'high']);
    $moved = $bulk($mara, [$first->id], ['state_id' => $state($project, 'Todo'), 'priority' => 'urgent']);

    expect($result)->toBe(['updated' => [$first->id, $second->id, $same->id], 'rejected' => [['id' => $archived->id, 'reason' => 'archived']]])
        ->and(eventsOf(EventType::WorkItemUpdated)->pluck('subject_id')->all())->toBe([$first->id, $second->id, $first->id])
        ->and(eventsOf(EventType::WorkItemUpdated, $first)->first()?->changes)->toBe(['priority' => ['old' => 'none', 'new' => 'high']])
        ->and(eventsOf(EventType::WorkItemUpdated, $first)->first()?->actor_id)->toBe($mara->id)
        ->and($same->fresh()?->updated_at?->isYesterday())->toBeTrue()
        ->and(Event::query()->where('subject_id', $archived->id)->count())->toBe(0)
        ->and($moved)->toBe(['updated' => [$first->id], 'rejected' => []])
        ->and(eventsOf(EventType::WorkItemStateChanged, $first))->toHaveCount(1);
});
