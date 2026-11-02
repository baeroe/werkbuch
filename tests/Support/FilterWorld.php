<?php

namespace Tests\Support;

use App\Domain\Filter\Filter;
use App\Domain\Filter\FilterSchema;
use App\Domain\Workflow\StateCategory;
use App\Domain\WorkItems\Priority;
use App\Models\Label;
use App\Models\Project;
use App\Models\Resolution;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkflowState;
use App\Models\WorkItem;
use App\Models\WorkItemRelation;
use App\Models\WorkItemType;
use App\Views\CatalogProperties;
use App\Views\FilterQuery;

/**
 * The world of the filter tests, shaped like `src/domain/fixtures.ts` of the clickdummy: the projects WEB and OPS on
 * the default workflow, Mara (the reader, `me`), Jonas and Ida, the labels Formulare, Produktion and UX, and the items
 * WEB-47 (blocked by OPS-12), OPS-12, WEB-41 (overdue), WEB-39 (overdue but done) and the epic WEB-30 with one child.
 * Every other item a test needs comes from `item()`, with the defaults of `makeWorkItem`.
 */
final class FilterWorld
{
    private function __construct(
        public readonly User $mara,
        public readonly User $jonas,
        public readonly User $ida,
        public readonly Project $web,
        public readonly Project $ops,
        public readonly WorkItemType $task,
        public readonly WorkItemType $bug,
        public readonly WorkItemType $epic,
        public readonly Label $forms,
        public readonly Label $production,
        public readonly Label $ux,
        public WorkItem $web47 = new WorkItem,
        public WorkItem $ops12 = new WorkItem,
        public WorkItem $overdueStarted = new WorkItem,
        public WorkItem $overdueDone = new WorkItem,
        public WorkItem $epicWithoutCustomer = new WorkItem,
        public WorkItem $epicChild = new WorkItem,
    ) {}

    public static function build(): self
    {
        $person = fn (string $name, string $handle) => User::factory()->create(['name' => $name, 'handle' => $handle]);
        $mara = $person('Mara Lindqvist', 'mara');
        $jonas = $person('Jonas Feld', 'jonas');
        $ida = $person('Ida Brenner', 'ida');

        $type = fn (string $name) => WorkItemType::query()->where('name', $name)->sole();
        $label = fn (string $name) => Label::factory()->create(['name' => $name]);

        $world = new self(
            $mara, $jonas, $ida,
            Project::factory()->identifier('WEB')->public()->create(['name' => 'Website', 'lead_id' => $ida->id]),
            Project::factory()->identifier('OPS')->private()->create(['name' => 'Betrieb', 'lead_id' => $jonas->id]),
            $type('Task'), $type('Bug'), $type('Epic'),
            $label('Formulare'), $label('Produktion'), $label('UX'),
        );

        $world->web47 = $world->item([
            'type_id' => $world->bug->id, 'title' => 'Kontaktformular sendet doppelt', 'state' => 'In Progress',
            'assignee_id' => $jonas->id, 'priority' => Priority::Urgent, 'start_date' => '2026-10-27',
            'due_date' => '2026-10-31', 'created_at' => '2026-10-20 09:30:00', 'updated_at' => '2026-10-27 08:15:00',
            'started_at' => '2026-10-27 08:15:00',
        ], [$world->forms, $world->production]);

        $world->ops12 = $world->item([
            'project_id' => $world->ops->id, 'title' => 'Mail-Limits am Server erhöhen', 'state' => 'In Progress',
            'assignee_id' => $jonas->id, 'priority' => Priority::High, 'due_date' => '2026-10-30',
            'started_at' => '2026-10-26 09:00:00',
        ]);
        WorkItemRelation::factory()->blocks()->create(['source_id' => $world->ops12->id, 'target_id' => $world->web47->id]);

        $world->overdueStarted = $world->item([
            'title' => 'Impressum aktualisieren', 'state' => 'In Progress', 'assignee_id' => $ida->id,
            'priority' => Priority::High, 'due_date' => '2026-10-27', 'started_at' => '2026-10-22 07:45:00',
        ]);

        $world->overdueDone = $world->item([
            'title' => 'Domain auf neuen Server umziehen', 'state' => 'Done',
            'resolution_id' => Resolution::query()->where('default_for', StateCategory::Completed->value)->value('id'),
            'assignee_id' => $jonas->id, 'priority' => Priority::Medium, 'due_date' => '2026-10-26',
            'started_at' => '2026-10-19 08:00:00', 'closed_at' => '2026-10-27 15:20:00',
        ]);

        $world->epicWithoutCustomer = $world->item([
            'type_id' => $world->epic->id, 'title' => 'Relaunch Phase 1', 'state' => 'In Progress',
            'start_date' => '2026-10-01', 'due_date' => '2026-11-15', 'started_at' => '2026-10-01 08:00:00',
        ]);
        $world->epicChild = $world->item(['parent_id' => $world->epicWithoutCustomer->id, 'title' => 'Startseite umbauen']);

        return $world;
    }

    /**
     * An item with the defaults of `makeWorkItem`: in WEB, a task in Todo, created by Mara on 2026-10-01 08:00 UTC,
     * nobody assigned, no priority. `state` names a state of the default workflow; times are UTC.
     *
     * @param  array<string, mixed>  $overrides
     * @param  list<Label>  $labels
     */
    public function item(array $overrides = [], array $labels = []): WorkItem
    {
        $state = $overrides['state'] ?? 'Todo';
        unset($overrides['state']);

        $item = WorkItem::factory()->create([
            'project_id' => $this->web->id,
            'type_id' => $this->task->id,
            'title' => 'Beispielaufgabe',
            'state_id' => $this->state(is_string($state) ? $state : 'Todo'),
            'priority' => Priority::None,
            'created_by' => $this->mara->id,
            'created_at' => '2026-10-01 08:00:00',
            'updated_at' => '2026-10-01 08:00:00',
            ...$overrides,
        ]);
        $item->labels()->attach(array_map(fn (Label $label) => $label->id, $labels));

        return $item;
    }

    /** The ULID of the state of that name in the default workflow. */
    public function state(string $name): string
    {
        return WorkflowState::query()->where('workflow_id', Workflow::default()->id)->where('name', $name)->sole()->id;
    }

    /**
     * Whether the item matches the filter of these conditions (parsed strictly, as input), read by the reader (Mara).
     *
     * @param  array<string, mixed>  ...$conditions
     */
    public function matches(WorkItem $item, array ...$conditions): bool
    {
        return $this->matchesFilter($item, $this->filter(...$conditions));
    }

    public function matchesFilter(WorkItem $item, Filter $filter, ?User $reader = null): bool
    {
        return FilterQuery::apply(WorkItem::query(), $filter, $reader ?? $this->mara)->whereKey($item->id)->exists();
    }

    /**
     * The ULIDs of every item the filter of these conditions matches, in the order of their ULIDs.
     *
     * @param  array<string, mixed>  ...$conditions
     * @return list<string>
     */
    public function ids(array ...$conditions): array
    {
        /** @var list<string> */
        return FilterQuery::apply(WorkItem::query(), $this->filter(...$conditions), $this->mara)->orderBy('id')->pluck('id')->all();
    }

    /**
     * @param  array<string, mixed>  ...$conditions
     */
    public function filter(array ...$conditions): Filter
    {
        return FilterSchema::parse(['version' => 1, 'conditions' => array_values($conditions)], CatalogProperties::load());
    }
}
