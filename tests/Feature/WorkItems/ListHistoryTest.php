<?php

use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Access\Visibility;
use App\Actions\Comments\AddComment;
use App\Actions\Comments\DeleteComment;
use App\Actions\Comments\EditComment;
use App\Actions\Projects\UpdateProject;
use App\Actions\Workflows\SaveWorkflow;
use App\Actions\WorkItems\AddRelation;
use App\Actions\WorkItems\ArchiveWorkItem;
use App\Actions\WorkItems\ChangeWorkItemType;
use App\Actions\WorkItems\CreateWorkItem;
use App\Actions\WorkItems\DeleteWorkItem;
use App\Actions\WorkItems\ListHistory;
use App\Actions\WorkItems\RestoreWorkItem;
use App\Actions\WorkItems\SetSubscription;
use App\Actions\WorkItems\TransitionWorkItem;
use App\Actions\WorkItems\UpdateWorkItem;
use App\Domain\Ranking\Rank;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Http\Resources\HistoryEntryResource;
use App\Models\Event;
use App\Models\Label;
use App\Models\Project;
use App\Models\RelationType;
use App\Models\Resolution;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkflowState;
use App\Models\WorkItem;
use App\Models\WorkItemType;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Tests\Support\RichTextFixtures as F;
use Tests\Support\WorkflowFixtures;

/**
 * WEB (public) with Mara as its admin and lead, OPS (private) with Mara as a member, and Ida, a member of WEB who does
 * not see OPS.
 */
$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara']);
    $web = Project::factory()->identifier('WEB')->public()->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $ops = Project::factory()->identifier('OPS')->private()->member($mara, ProjectRole::Member)->create(['lead_id' => $mara->id]);
    $ida = memberOf($web, ProjectRole::Member, ['name' => 'Ida']);

    return [$web, $ops, $mara, $ida];
};

/**
 * The history of the item as the reader gets it over REST: the entries of one page, each through HistoryEntryResource.
 *
 * @return list<array<string, mixed>>
 */
$history = function (User $reader, WorkItem $item, array $query = []): array {
    $page = ListHistory::run(actor($reader), $item, $query)->page;

    return array_map(fn (Event $event) => (new HistoryEntryResource($event))->resolve(), $page->items());
};

$relate = fn (User $user, WorkItem $source, RelationType $type, WorkItem $target) => AddRelation::run(actor($user), $source, ['type_id' => $type->id, 'target_id' => $target->id]);

$builtIn = fn (string $key): RelationType => RelationType::query()->where('built_in', $key)->firstOrFail();

/** `changes.relation` of every entry, in order. */
$relations = fn (array $entries): array => array_map(fn (array $entry) => $entry['changes']['relation'], $entries);

it('shows every change with old and new value, oldest first', function () use ($world, $history) {
    [$web, , $mara] = $world();
    $type = fn (string $name): string => (string) WorkItemType::query()->where('name', $name)->value('id');
    $label = Label::factory()->create();
    $done = (string) $web->workflow()->firstOrFail()->states()->where('name', 'Done')->value('id');
    $resolution = (string) Resolution::query()->where('default_for', 'completed')->value('id');

    $item = CreateWorkItem::run(actor($mara), ['project_id' => $web->id, 'title' => 'Absturz', 'type_id' => $type('Bug')]);
    $update = fn (array $input) => UpdateWorkItem::run(actor($mara), $item, $input);
    $update(['title' => 'Absturz beim Speichern']);
    $update(['priority' => 'high']);
    $update(['label_ids' => [$label->id]]);
    $update(['values' => ['effort' => 2.5]]);
    TransitionWorkItem::run(actor($mara), $item, ['to_state_id' => $done, 'resolution_id' => $resolution]);
    $update(['assignee_id' => $mara->id]);
    ChangeWorkItemType::run(actor($mara), $item, ['type_id' => $type('Task')]);
    ArchiveWorkItem::run(actor($mara), $item);
    RestoreWorkItem::run(actor($mara), $item);

    $entries = $history($mara, $item);
    $change = fn (int $index, string $field): array => $entries[$index]['changes'][$field];

    expect(array_column($entries, 'type'))->toBe([
        'work_item.created', 'work_item.updated', 'work_item.updated', 'work_item.updated', 'work_item.updated',
        'work_item.state_changed', 'work_item.assigned', 'work_item.updated', 'work_item.archived', 'work_item.restored',
    ])
        ->and($change(0, 'title'))->toBe(['old' => null, 'new' => 'Absturz'])
        ->and($change(1, 'title'))->toBe(['old' => 'Absturz', 'new' => 'Absturz beim Speichern'])
        ->and($change(2, 'priority'))->toBe(['old' => 'none', 'new' => 'high'])
        ->and($change(3, 'label_ids'))->toBe(['old' => [], 'new' => [$label->id]])
        ->and($change(4, 'values.effort'))->toBe(['old' => null, 'new' => 2.5])
        ->and($change(5, 'state_id')['new'])->toBe($done)
        ->and($change(5, 'resolution_id'))->toBe(['old' => null, 'new' => $resolution])
        ->and($change(6, 'assignee_id'))->toBe(['old' => null, 'new' => $mara->id])
        ->and($change(7, 'type_id'))->toBe(['old' => $type('Bug'), 'new' => $type('Task')])
        // what the new type lacks leaves with its old value
        ->and($change(7, 'values.effort'))->toBe(['old' => 2.5, 'new' => null])
        ->and($change(8, 'archived_at')['old'])->toBeNull()
        ->and($change(9, 'archived_at')['new'])->toBeNull()
        // every entry as stored, in the order of the events
        ->and(array_column($entries, 'id'))->toBe(Event::query()->where('subject_id', $item->id)->orderBy('occurred_at')->orderBy('id')->pluck('id')->all());
});

it('names who did it, how and why', function () use ($world, $history) {
    [$web, , $mara] = $world();
    $parent = WorkItem::factory()->for($web)->create();
    $child = WorkItem::factory()->for($web)->childOf($parent)->create();

    $this->withToken(apiToken($mara, ['read', 'write']))->patchJson("/api/v1/work-items/{$child->key}", ['title' => 'Über die API'])->assertOk();
    DeleteWorkItem::run(actor($mara), $parent);

    [$patched, $orphaned] = $history($mara, $child);

    expect($patched)->toBe([
        'id' => $patched['id'],
        'type' => 'work_item.updated',
        'actor_id' => $mara->id,
        'subject' => ['type' => 'work_item', 'id' => $child->id],
        'project_id' => $web->id,
        'changes' => ['title' => ['old' => $child->title, 'new' => 'Über die API']],
        'states' => null,
        'reason' => null,
        'via' => 'api',
        // no comment: an item's own change
        'comment_id' => null,
        'comment_author_id' => null,
        'occurred_at' => Event::query()->findOrFail($patched['id'])->occurred_at->toJSON(),
    ])
        ->and([$orphaned['type'], $orphaned['via'], $orphaned['reason']])->toBe(['work_item.updated', 'ui', DeleteWorkItem::PARENT_DELETED])
        ->and($orphaned['changes'])->toBe(['parent_id' => ['old' => $parent->id, 'new' => null]]);
});

it('names a hidden item only as hidden', function () use ($world, $history, $relate, $builtIn, $relations) {
    [$web, $ops, $mara, $ida] = $world();
    $item = WorkItem::factory()->for($web)->create();
    $secret = WorkItem::factory()->for($ops)->create(['title' => 'Geheimer Umzug']);
    $blocks = $builtIn('blocks');
    $relate($mara, $item, $blocks, $secret);

    $seen = $history($ida, $item);

    expect($relations($seen))->toBe([['old' => null, 'new' => ['label' => $blocks->outward_label, 'hidden' => true]]])
        // nothing of the other end leaves the server: no id, no key, no title, not even the type's id
        ->and(json_encode($seen))->not->toContain($secret->id)->not->toContain('OPS-')->not->toContain('Geheimer')->not->toContain($blocks->id)
        // who sees OPS gets the current key, and the target reads the inward label
        ->and($relations($history($mara, $item)))->toBe([['old' => null, 'new' => ['label' => $blocks->outward_label, 'item_id' => $secret->id, 'key' => 'OPS-1']]])
        ->and($relations($history($mara, $secret)))->toBe([['old' => null, 'new' => ['label' => $blocks->inward_label, 'item_id' => $item->id, 'key' => 'WEB-1']]]);
});

it('shows the current key of a renamed project', function () use ($world, $history, $relate, $builtIn, $relations) {
    [$web, , $mara] = $world();
    [$item, $other] = WorkItem::factory()->for($web)->count(2)->create();
    $relates = $builtIn('relates');
    $relate($mara, $item, $relates, $other);

    UpdateProject::run(actor($mara), $web, ['identifier' => 'NEW']);

    expect($relations($history($mara, $item)))->toBe([['old' => null, 'new' => ['label' => $relates->outward_label, 'item_id' => $other->id, 'key' => 'NEW-2']]])
        // a symmetric type reads the same from the other end
        ->and($relations($history($mara, $other)))->toBe([['old' => null, 'new' => ['label' => $relates->outward_label, 'item_id' => $item->id, 'key' => 'NEW-1']]]);
});

it('names a deleted item as hidden', function () use ($world, $history, $relate, $builtIn, $relations) {
    [$web, , $mara] = $world();
    [$item, $other] = WorkItem::factory()->for($web)->count(2)->create();
    $blocks = $builtIn('blocks');
    $relate($mara, $item, $blocks, $other);

    DeleteWorkItem::run(actor($mara), $other);
    $entries = $history($mara, $item);

    expect(array_column($entries, 'type'))->toBe(['work_item.relation_added', 'work_item.relation_removed'])
        ->and($relations($entries))->toBe([
            ['old' => null, 'new' => ['label' => $blocks->outward_label, 'hidden' => true]],
            ['old' => ['label' => $blocks->outward_label, 'hidden' => true], 'new' => null],
        ])
        ->and(json_encode($entries))->not->toContain($other->id);
});

it('reads the label of the type as it is now, and the stored one once the type is gone', function () use ($world, $history, $relate, $relations) {
    [$web, , $mara] = $world();
    [$item, $other] = WorkItem::factory()->for($web)->count(2)->create();
    $tests = RelationType::factory()->create(['name' => 'Tests', 'outward_label' => 'testet', 'inward_label' => 'wird getestet von']);
    $relate($mara, $item, $tests, $other);

    $tests->update(['outward_label' => 'prüft', 'inward_label' => 'wird geprüft von']);
    $renamed = [$relations($history($mara, $item)), $relations($history($mara, $other))];
    // deleting the type takes its relations along; the events stay with what they stored
    $tests->delete();

    expect($renamed)->toBe([
        [['old' => null, 'new' => ['label' => 'prüft', 'item_id' => $other->id, 'key' => 'WEB-2']]],
        [['old' => null, 'new' => ['label' => 'wird geprüft von', 'item_id' => $item->id, 'key' => 'WEB-1']]],
    ])
        ->and($relations($history($mara, $item)))->toBe([['old' => null, 'new' => ['label' => 'testet', 'item_id' => $other->id, 'key' => 'WEB-2']]])
        ->and($relations($history($mara, $other)))->toBe([['old' => null, 'new' => ['label' => 'wird getestet von', 'item_id' => $item->id, 'key' => 'WEB-1']]]);
});

it('names the states of a move as they were, also once a state is removed', function () use ($world, $history) {
    [$web, , $mara] = $world();
    $standard = Workflow::default();
    $item = WorkItem::factory()->for($web)->inState('Todo')->create();
    $state = fn (string $name): string => (string) $standard->states()->where('name', $name)->value('id');
    [$todo, $pending, $backlog] = [$state('Todo'), $state('Pending'), $state('Backlog')];
    TransitionWorkItem::run(actor($mara), $item, ['to_state_id' => $pending]);

    // Pending goes, its items move to Backlog
    $input = WorkflowFixtures::inputOf($standard);
    $input['states'] = array_values(array_filter($input['states'], fn (array $state) => $state['id'] !== $pending));
    SaveWorkflow::run(actor(User::factory()->admin()->create()), $standard, [...$input, 'state_mapping' => [$pending => $backlog]]);

    [$moved, $removed] = $history($mara, $item);

    expect(WorkflowState::query()->whereKey($pending)->exists())->toBeFalse()
        ->and($moved['states'])->toBe([
            'old' => ['id' => $todo, 'name' => 'Todo', 'category' => 'unstarted'],
            'new' => ['id' => $pending, 'name' => 'Pending', 'category' => 'started'],
        ])
        ->and([$removed['reason'], $removed['states']['old']['name'], $removed['states']['new']['name']])->toBe(['state_removed', 'Pending', 'Backlog']);
});

it('shows a move recorded before the snapshot without states', function () use ($world, $history) {
    [$web, , $mara] = $world();
    $item = WorkItem::factory()->for($web)->create();
    TransitionWorkItem::run(actor($mara), $item, ['to_state_id' => (string) $web->workflow()->firstOrFail()->states()->where('name', 'Todo')->value('id')]);
    // as events were stored before meta.states
    $event = eventsOf(EventType::WorkItemStateChanged, $item)->sole();
    $event->update(['meta' => array_diff_key($event->meta, ['states' => true])]);

    [$entry] = $history($mara, $item);

    expect($entry['type'])->toBe('work_item.state_changed')
        ->and($entry['states'])->toBeNull()
        ->and(array_keys($entry['changes']))->toBe(['state_id']);
});

it('leaves out watching and pure reordering', function () use ($world, $history) {
    [$web, , $mara] = $world();
    [$item, $neighbour] = WorkItem::factory()->for($web)->count(2)->create();

    SetSubscription::run(actor($mara), $item, true);
    SetSubscription::run(actor($mara), $item, false);
    UpdateWorkItem::run(actor($mara), $item, ['rank' => Rank::between($neighbour->rank, null)]);
    // a change of another item is not this one's
    UpdateWorkItem::run(actor($mara), $neighbour, ['title' => 'Nachbar']);
    // a move together with another change is history
    UpdateWorkItem::run(actor($mara), $item, ['rank' => Rank::between(null, $neighbour->rank), 'title' => 'Ganz oben']);

    $entries = $history($mara, $item);

    expect(array_column($entries, 'type'))->toBe(['work_item.updated'])
        ->and(array_keys($entries[0]['changes']))->toEqualCanonicalizing(['rank', 'title']);
});

it('shows comment edits and deletions, not the creation and not reactions', function () use ($world, $history) {
    [$web, , $mara, $ida] = $world();
    $item = WorkItem::factory()->for($web)->create();
    $kira = User::factory()->bot($mara)->create(['handle' => 'kira']);
    app(RoleAssignments::class)->setProjectRole($kira, $web, ProjectRole::Member);

    $comment = AddComment::run(actor($ida), $item, ['body' => 'Erster Endwurf, @kira']);
    DB::transaction(function () use ($ida, $item, $web, $comment): void {
        EventRecorder::record(EventType::CommentReactionAdded, actor($ida), $item, $web, null, ['comment_id' => $comment->id, 'emoji' => '👍']);
        EventRecorder::record(EventType::CommentReactionRemoved, actor($ida), $item, $web, null, ['comment_id' => $comment->id, 'emoji' => '👍']);
    });
    EditComment::run(actor($ida), $comment, ['body' => 'Erster Entwurf, @kira']);
    $kept = AddComment::run(actor($mara), $item, ['body' => 'Bleibt.']);
    DeleteComment::run(actor($mara), $kept);

    $entries = $history($ida, $item);

    expect(array_column($entries, 'type'))->toBe(['comment.updated', 'comment.deleted'])
        ->and($entries[0]['changes'])->toBe(['body' => [
            'old' => F::doc(F::p('Erster Endwurf, ', F::mention($kira->id, 'kira'))),
            'new' => F::doc(F::p('Erster Entwurf, ', F::mention($kira->id, 'kira'))),
        ]])
        ->and($entries[0]['comment_id'])->toBe($comment->id)
        ->and($entries[0]['comment_author_id'])->toBe($ida->id)
        ->and($entries[0]['actor_id'])->toBe($ida->id)
        ->and($entries[1]['changes'])->toBeNull()
        ->and($entries[1]['comment_id'])->toBe($kept->id)
        ->and($entries[1]['comment_author_id'])->toBe($mara->id)
        ->and($entries[1]['actor_id'])->toBe($mara->id);
});

it('hides the versions of a comment that was deleted later', function () use ($world, $history) {
    [$web, , $mara] = $world();
    $item = WorkItem::factory()->for($web)->create();
    $gone = AddComment::run(actor($mara), $item, ['body' => 'Passwort: hunter2']);
    EditComment::run(actor($mara), $gone, ['body' => 'Passwort geändert']);
    $kept = AddComment::run(actor($mara), $item, ['body' => 'eins']);
    EditComment::run(actor($mara), $kept, ['body' => 'zwei']);
    DeleteComment::run(actor($mara), $gone);

    $entries = $history($mara, $item);

    expect(array_column($entries, 'type'))->toBe(['comment.updated', 'comment.updated', 'comment.deleted'])
        ->and($entries[0]['comment_id'])->toBe($gone->id)
        ->and($entries[0]['changes'])->toBeNull()
        ->and($entries[1]['changes'])->toBe(['body' => ['old' => F::doc(F::p('eins')), 'new' => F::doc(F::p('zwei'))]])
        ->and(json_encode($entries))->not->toContain('hunter2');
});

it('pages with a cursor, by time to the microsecond and then by id', function () use ($world) {
    [$web, , $mara] = $world();
    $item = WorkItem::factory()->for($web)->create();
    $at = function (string $time, string $title) use ($mara, $item): string {
        Carbon::setTestNow(Carbon::parse("2026-10-31 12:00:00.{$time}"));

        return UpdateWorkItem::run(actor($mara), $item, ['title' => $title])->title;
    };

    // one second, and the last change written stamped before all others: the time decides, not the id
    $at('300000', 'B');
    $at('400000', 'C');
    $at('400000', 'D');
    $at('500000', 'E');
    $at('100000', 'A');
    Carbon::setTestNow();

    $titles = [];
    $cursor = null;
    $pages = 0;
    // at most five rounds: a cursor that lost the microseconds would hand out the same page again and again
    do {
        $result = ListHistory::run(actor($mara), $item, ['per_page' => 2, 'cursor' => $cursor]);
        $titles = [...$titles, ...array_map(fn (Event $event) => $event->changes['title']['new'] ?? null, $result->page->items())];
        $cursor = $result->page->nextCursor()?->encode();
        $pages++;
    } while ($cursor !== null && $pages < 5);

    expect($titles)->toBe(['A', 'B', 'C', 'D', 'E'])
        ->and($pages)->toBe(3)
        ->and($result->total)->toBe(5);
});

it('answers 404 for an item the account does not see', function () use ($world) {
    [, $ops, , $ida] = $world();
    $secret = WorkItem::factory()->for($ops)->create();

    expect(problemOf(fn () => ListHistory::run(actor($ida), $secret, []))->status)->toBe(404)
        ->and(problemOf(fn () => ListHistory::run(actor(User::factory()->create()), $secret, []))->status)->toBe(404);
});

it('reads the other ends of a whole page at once and leaves the resource nothing to ask', function () use ($world, $relate, $builtIn) {
    [$web, , $mara] = $world();
    $item = WorkItem::factory()->for($web)->create();
    $others = WorkItem::factory()->for($web)->count(4)->create();
    $queries = function () use ($mara, $item): array {
        // each call reads who sees what afresh, as a request does
        Visibility::forget();
        DB::enableQueryLog();
        DB::flushQueryLog();
        $events = ListHistory::run(actor($mara), $item, [])->page->items();
        $listed = count(DB::getQueryLog());
        DB::flushQueryLog();
        array_map(fn (Event $event) => (new HistoryEntryResource($event))->resolve(), $events);
        $resolved = count(DB::getQueryLog());
        DB::disableQueryLog();

        return [$listed, $resolved];
    };

    $relate($mara, $item, $builtIn('relates'), $others[0]);
    $one = $queries();
    foreach ($others->slice(1) as $other) {
        $relate($mara, $item, $builtIn('blocks'), $other);
    }

    expect($queries())->toBe($one)
        ->and($one[1])->toBe(0);
});
