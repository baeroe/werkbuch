<?php

namespace Database\Seeders\Load;

use App\Domain\WorkItems\Priority;
use App\Events\EventType;
use App\Models\RelationType;
use App\Models\WorkItem;
use App\Support\Actor;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * The history of the load items as `events` rows (VERSION 2): every item has its `work_item.created`, then 0–8 more
 * events (priority, title or due date changed, state changed with the snapshot of both states, assigned), the item
 * LoadItems::BUSY and the first epic of every project HEAVY more, over several pages of the history. Every relation is
 * a `work_item.relation_added` at both ends (the shape of RelationSnapshot). Bulk inserts in blocks of 1 000 like the
 * rows of the items; `dispatched_at` = `occurred_at`, so nobody consumes them (P23, like the demo ActivitySeeder).
 */
final class LoadHistory
{
    /** The events beyond `created` of the item with 40 comments and of the epic with 40 children. */
    public const HEAVY = 150;

    /** @var list<array<string, mixed>> */
    private array $pending = [];

    /** @var array<string, array{outward: string, inward: string}> the labels of the relation types by id */
    private array $labels = [];

    private readonly string $subject;

    public function __construct()
    {
        $this->subject = (new WorkItem)->getMorphClass();
        foreach (RelationType::query()->get() as $type) {
            $this->labels[(string) $type->id] = ['outward' => $type->outward_label, 'inward' => $type->inward_label ?? $type->outward_label];
        }
    }

    /**
     * The history of one item: `created`, then the events after it, between its creation and its last change.
     *
     * @param  array<string, mixed>  $row  the row of work_items
     * @param  array{id: string, people: list<string>, states: list<array{id: string, name: string, category: string}>}  $project
     */
    public function item(array $row, array $project, bool $heavy): void
    {
        $created = (int) strtotime((string) $row['created_at'].' UTC');
        $until = max($created + 60, (int) strtotime(LoadItems::NOW.' UTC'));
        $this->add(EventType::WorkItemCreated, (string) $row['created_by'], $row, $created, ['title' => ['old' => null, 'new' => $row['title']]]);

        $more = $heavy ? self::HEAVY : LoadRandom::int(0, 8);
        for ($i = 0; $i < $more; $i++) {
            $at = LoadRandom::int($created + 60, $until);
            $actor = LoadRandom::pick($project['people']);
            $roll = LoadRandom::int(1, 10);

            if ($roll <= 3) {
                [$old, $new] = LoadRandom::some(array_map(fn (Priority $priority) => $priority->value, Priority::cases()), 2);
                $this->add(EventType::WorkItemUpdated, $actor, $row, $at, ['priority' => ['old' => $old, 'new' => $new]]);
            } elseif ($roll <= 4) {
                $this->add(EventType::WorkItemUpdated, $actor, $row, $at, ['title' => ['old' => LoadTexts::title(), 'new' => $row['title']]]);
            } elseif ($roll <= 5) {
                $this->add(EventType::WorkItemUpdated, $actor, $row, $at, ['due_date' => ['old' => null, 'new' => gmdate('Y-m-d', $at + LoadRandom::int(1, 60) * 86_400)]]);
            } elseif ($roll <= 8) {
                [$from, $to] = LoadRandom::some($project['states'], 2);
                $this->add(EventType::WorkItemStateChanged, $actor, $row, $at, ['state_id' => ['old' => $from['id'], 'new' => $to['id']]], ['states' => ['old' => $from, 'new' => $to]]);
            } else {
                $this->add(EventType::WorkItemAssigned, $actor, $row, $at, ['assignee_id' => ['old' => null, 'new' => LoadRandom::pick($project['people'])]]);
            }
        }
    }

    /**
     * A relation at both of its ends, as AddRelation writes it.
     *
     * @param  array{id: string, project: string}  $source
     * @param  array{id: string, project: string}  $target
     */
    public function relation(string $type, array $source, array $target, string $actor, int $at): void
    {
        foreach ([[$source, 'outward', $target], [$target, 'inward', $source]] as [$end, $direction, $other]) {
            $this->add(EventType::WorkItemRelationAdded, $actor, ['id' => $end['id'], 'project_id' => $end['project']], $at, ['relation' => ['old' => null, 'new' => [
                'relation_type_id' => $type,
                'direction' => $direction,
                'label' => $this->labels[$type][$direction],
                'item_id' => $other['id'],
            ]]]);
        }
    }

    public function flush(): void
    {
        if ($this->pending !== []) {
            DB::table('events')->insert($this->pending);
        }
        $this->pending = [];
    }

    /**
     * @param  array<string, mixed>  $item  `id` and `project_id` of the item
     * @param  array<string, mixed>  $changes
     * @param  array<string, mixed>  $meta
     */
    private function add(EventType $type, string $actor, array $item, int $at, array $changes, array $meta = []): void
    {
        $stamp = sprintf('%s.%06d', LoadItems::stamp($at), LoadRandom::int(0, 999_999));
        $this->pending[] = [
            'id' => strtolower((string) Str::ulid()),
            'type' => $type->value,
            'actor_id' => $actor,
            'subject_type' => $this->subject,
            'subject_id' => $item['id'],
            'project_id' => $item['project_id'],
            'changes' => json_encode($changes, JSON_THROW_ON_ERROR),
            'meta' => json_encode(['via' => Actor::VIA_UI, 'reason' => null, ...$meta], JSON_THROW_ON_ERROR),
            'occurred_at' => $stamp,
            'dispatched_at' => LoadItems::stamp($at),
            'redispatched_at' => null,
            'created_at' => LoadItems::stamp($at),
            'updated_at' => LoadItems::stamp($at),
        ];

        if (count($this->pending) >= LoadItems::BLOCK) {
            $this->flush();
        }
    }
}
