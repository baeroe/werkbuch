<?php

namespace Database\Seeders\Demo;

use App\Events\EventType;
use App\Models\Event;
use App\Models\Resolution;
use App\Models\User;
use App\Models\WorkflowState;
use App\Models\WorkItem;
use App\Models\WorkItemRelation;
use App\Models\WorkItemSubscriber;
use App\RichText\Document;
use App\Support\Actor;
use App\Support\RelationSnapshot;
use App\Support\StateSnapshot;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * The history and the watchers of the demo items: the events of src/api/seed/activity.ts (the history of WEB-47 is the
 * one of the moodboard), the relation events of the seeded relations and who watches which item. Needs the ItemsSeeder
 * before it. Written directly (A86) as `events` rows with `dispatched_at` = `occurred_at`: nobody consumes them (P23).
 * The comments and files are the CommentsSeeder's and the AttachmentsSeeder's.
 *
 * Safe to run again (K14): an item gets its events only while it has none at all, so a second run, and an item that
 * somebody has changed since, keep their history. Watchers are found by (item, person) and never changed.
 */
class ActivitySeeder extends Seeder
{
    use WithoutModelEvents;

    /**
     * The events by item, who and when (`MM-DD HH:mm`, Berlin time); the rest depends on the kind:
     *
     * - `created`: nothing more (the change is the title of the item),
     * - `state`: the state before and after (keys of ItemsSeeder::state()), `true` when the move closes the item as done,
     * - `assigned`: the handle of the new assignee, an optional reason (the automation, via `automation`) and seconds,
     * - `updated`: the changed fields as `field => [old, new]`.
     *
     * @var list<array<int, mixed>>
     */
    private const EVENTS = [
        // WEB-47: the history of the moodboard, oldest first
        ['created', 'WEB-47', 'ida', '10-20 11:30'],
        ['state', 'WEB-47', 'jonas', '10-27 09:15', 'todo', 'progress'],
        ['assigned', 'WEB-47', 'automation', '10-27 09:15', 'jonas', 'assign_on_start', 2],
        ['updated', 'WEB-47', 'ida', '10-27 10:20', ['priority' => ['high', 'urgent']]],

        ['created', 'WEB-42', 'ida', '10-15 10:05'],
        ['state', 'WEB-42', 'ida', '10-26 10:00', 'todo', 'progress'],

        ['created', 'WEB-30', 'ida', '10-01 09:00'],
        ['state', 'WEB-30', 'ida', '10-01 10:00', 'backlog', 'progress'],

        ['state', 'WEB-45', 'ida', '10-22 09:30', 'progress', 'pending'],
        ['assigned', 'WEB-48', 'ida', '10-21 09:40', 'lene'],

        ['state', 'WEB-41', 'ida', '10-22 09:45', 'todo', 'progress'],
        ['updated', 'WEB-41', 'ida', '10-24 12:00', ['due_date' => ['2026-10-25', '2026-10-27']]],

        ['state', 'WEB-39', 'jonas', '10-19 10:00', 'todo', 'progress'],
        ['state', 'WEB-39', 'jonas', '10-27 16:20', 'progress', 'done', true],
        ['state', 'WEB-40', 'lene', '10-23 14:10', 'todo', 'done', true],

        ['created', 'OPS-12', 'mara', '10-20 14:00'],
        ['state', 'OPS-3', 'jonas', '09-01 09:00', 'backlog', 'progress'],
        ['state', 'OPS-11', 'jonas', '10-27 14:00', 'progress', 'done', true],

        ['created', 'APP-5', 'theo', '10-02 09:00'],
        ['state', 'APP-5', 'theo', '10-20 09:00', 'todo', 'progress'],
        ['state', 'APP-12', 'lene', '10-27 17:15', 'progress', 'review'],
        ['created', 'APP-15', 'mara', '10-16 09:30'],
        ['state', 'APP-15', 'theo', '10-24 10:00', 'review', 'approval'],
        ['assigned', 'APP-24', 'theo', '10-27 16:05', 'mara'],
    ];

    public function run(): void
    {
        // one transaction: a run that breaks halfway would leave items with part of their events, and a rerun skips
        // every item that has any (K14)
        DB::transaction(fn () => $this->seed());
    }

    private function seed(): void
    {
        // the base collection: an Eloquent one reads `only()` as a list of primary keys
        /** @var Collection<string, WorkItem> $items by key */
        $items = WorkItem::query()->with('project')->get()->keyBy(fn (WorkItem $item) => $item->key)->toBase();
        $people = User::query()->get()->keyBy('handle');
        $seeded = $items->only(array_map(fn (array $row) => $row['key'], ItemsSeeder::rows()));

        // read before anything is written: an item that has no events now gets all of its own, whatever order they come in
        $withEvents = Event::query()->where('subject_type', (new WorkItem)->getMorphClass())
            ->whereIn('subject_id', $seeded->map->id->all())->distinct()->pluck('subject_id')->flip();
        $fresh = $seeded->reject(fn (WorkItem $item) => $withEvents->has($item->id));

        foreach (self::EVENTS as $row) {
            $item = $fresh->get($row[1]);
            if ($item !== null) {
                $this->write($item, $row, $people);
            }
        }

        $this->relationEvents($fresh);
        $this->watchers($seeded, $people);
    }

    /**
     * @param  array<int, mixed>  $row
     * @param  Collection<string, User>  $people
     */
    private function write(WorkItem $item, array $row, Collection $people): void
    {
        [$kind, , $by, $when] = $row;
        $at = ItemsSeeder::at($when, $kind === 'assigned' ? (int) ($row[6] ?? 0) : 0);
        $reason = $kind === 'assigned' ? ($row[5] ?? null) : null;
        $meta = ['via' => $reason === null ? Actor::VIA_UI : Actor::VIA_AUTOMATION, 'reason' => $reason];

        switch ($kind) {
            case 'created':
                $type = EventType::WorkItemCreated;
                $changes = ['title' => ['old' => null, 'new' => $item->title]];
                break;
            case 'state':
                $states = WorkflowState::query()->where('workflow_id', $item->project->workflow_id)->get()->keyBy('name');
                $from = $states->get(ItemsSeeder::state($row[4]));
                $to = $states->get(ItemsSeeder::state($row[5]));
                if ($from === null || $to === null) {
                    // the project works with another workflow now: these states are no history it can show
                    return;
                }

                $type = EventType::WorkItemStateChanged;
                $changes = ['state_id' => ['old' => $from->id, 'new' => $to->id]];
                if (($row[6] ?? false) === true) {
                    $changes['resolution_id'] = ['old' => null, 'new' => Resolution::query()->where('default_for', $to->category->value)->value('id')];
                }
                $meta['states'] = StateSnapshot::of($from, $to);
                break;
            case 'assigned':
                $type = EventType::WorkItemAssigned;
                $changes = ['assignee_id' => ['old' => null, 'new' => $this->person($people, $row[4])->id]];
                break;
            default:
                $type = EventType::WorkItemUpdated;
                $changes = array_map(fn (array $change) => ['old' => $change[0], 'new' => $change[1]], $row[4]);
        }

        $this->record($type, $this->person($people, $by), $item, $at, $changes, $meta);
    }

    /**
     * A relation is in the history of both its ends (`work_item.relation_added`, the shape of RelationSnapshot): the
     * source's creator adds it, a minute after the later of the two items, as the relation row says.
     *
     * @param  Collection<string, WorkItem>  $fresh
     */
    private function relationEvents(Collection $fresh): void
    {
        foreach (ItemsSeeder::RELATIONS as [, $source, $target]) {
            $from = ItemsSeeder::find($source);
            $to = ItemsSeeder::find($target);
            if ($from === null || $to === null) {
                continue;
            }

            $relation = WorkItemRelation::query()->with('type')->where('source_id', $from->id)->where('target_id', $to->id)->first();
            if ($relation === null) {
                continue;
            }

            foreach ([$from, $to] as $end) {
                if ($fresh->contains(fn (WorkItem $item) => $item->id === $end->id)) {
                    $end->load('project');
                    $this->record(EventType::WorkItemRelationAdded, User::query()->findOrFail($from->created_by), $end, $relation->created_at ?? Carbon::now(), [
                        'relation' => ['old' => null, 'new' => RelationSnapshot::of($relation, $end)],
                    ], ['via' => Actor::VIA_UI, 'reason' => null]);
                }
            }
        }
    }

    /**
     * @param  Collection<string, User>  $people
     */
    private function person(Collection $people, string $handle): User
    {
        return $people[$handle] ?? throw new RuntimeException("No account @{$handle}.");
    }

    /**
     * @param  array<string, array{old: mixed, new: mixed}>  $changes
     * @param  array<string, mixed>  $meta
     */
    private function record(EventType $type, User $actor, WorkItem $item, \DateTimeInterface $at, array $changes, array $meta): void
    {
        Event::query()->create([
            'type' => $type,
            'actor_id' => $actor->id,
            'subject_type' => $item->getMorphClass(),
            'subject_id' => $item->id,
            'project_id' => $item->project_id,
            'changes' => $changes,
            'meta' => $meta,
            'occurred_at' => $at,
            'dispatched_at' => $at,
        ]);
    }

    /**
     * Who watches an item (spec 4.10): the person who created it, the one it is assigned to and the people its
     * description mentions; the CommentsSeeder adds who commented and whom a comment mentions. Bots and deactivated
     * accounts do not watch (they get no notifications).
     *
     * @param  Collection<string, WorkItem>  $items
     * @param  Collection<string, User>  $people
     */
    private function watchers(Collection $items, Collection $people): void
    {
        $watches = fn (?string $id) => $id !== null && ($user = $people->firstWhere('id', $id)) !== null
            && $user->isPerson() && $user->disabled_at === null;

        foreach ($items as $item) {
            if ($watches($item->created_by)) {
                WorkItemSubscriber::query()->firstOrCreate(['work_item_id' => $item->id, 'user_id' => $item->created_by], ['reason' => 'created']);
            }
            if ($item->assignee_id !== $item->created_by && $watches($item->assignee_id)) {
                WorkItemSubscriber::query()->firstOrCreate(['work_item_id' => $item->id, 'user_id' => $item->assignee_id], ['reason' => 'assigned']);
            }
            foreach ($item->description === null ? [] : Document::fromJson($item->description)->mentionedUserIds() as $mentioned) {
                if ($watches($mentioned)) {
                    WorkItemSubscriber::query()->firstOrCreate(['work_item_id' => $item->id, 'user_id' => $mentioned], ['reason' => 'mentioned']);
                }
            }
        }
    }
}
