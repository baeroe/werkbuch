<?php

namespace Tests\Support;

use App\Domain\Workflow\State;
use App\Domain\Workflow\StateCategory;
use App\Domain\Workflow\StateIcon;
use App\Domain\Workflow\TransitionGraph;
use App\Http\Resources\WorkflowResource;
use App\Models\Workflow;

/**
 * The two workflows of the clickdummy (`src/domain/fixtures.ts`), as a graph for the domain tests and as REST input for
 * the feature tests and the rights matrix; and a saved workflow as input again.
 */
final class WorkflowFixtures
{
    /** @var list<array{id: string, name: string, icon: string, category: string}> */
    private const STANDARD_STATES = [
        ['id' => 'std_backlog', 'name' => 'Backlog', 'icon' => 'dashed', 'category' => 'backlog'],
        ['id' => 'std_todo', 'name' => 'Todo', 'icon' => 'circle', 'category' => 'unstarted'],
        ['id' => 'std_progress', 'name' => 'In Progress', 'icon' => 'half', 'category' => 'started'],
        ['id' => 'std_pending', 'name' => 'Pending', 'icon' => 'pause', 'category' => 'started'],
        ['id' => 'std_done', 'name' => 'Done', 'icon' => 'check', 'category' => 'completed'],
        ['id' => 'std_cancelled', 'name' => 'Cancelled', 'icon' => 'cross', 'category' => 'canceled'],
    ];

    /** @var list<array{id: string, name: string, icon: string, category: string}> */
    private const AGENCY_STATES = [
        ['id' => 'app_backlog', 'name' => 'Backlog', 'icon' => 'dashed', 'category' => 'backlog'],
        ['id' => 'app_todo', 'name' => 'Todo', 'icon' => 'circle', 'category' => 'unstarted'],
        ['id' => 'app_progress', 'name' => 'In Progress', 'icon' => 'half', 'category' => 'started'],
        ['id' => 'app_review', 'name' => 'Review', 'icon' => 'three-quarter', 'category' => 'started'],
        ['id' => 'app_approval', 'name' => 'Kundenfreigabe', 'icon' => 'pause', 'category' => 'started'],
        ['id' => 'app_done', 'name' => 'Done', 'icon' => 'check', 'category' => 'completed'],
        ['id' => 'app_cancelled', 'name' => 'Cancelled', 'icon' => 'cross', 'category' => 'canceled'],
    ];

    /** @var list<array{0: string, 1: string}> */
    private const AGENCY_TRANSITIONS = [
        ['app_backlog', 'app_todo'],
        ['app_todo', 'app_progress'],
        ['app_progress', 'app_review'],
        ['app_review', 'app_progress'],
        ['app_review', 'app_approval'],
        ['app_approval', 'app_done'],
        ['app_approval', 'app_progress'],
        // every open status can be cancelled
        ['app_backlog', 'app_cancelled'],
        ['app_todo', 'app_cancelled'],
        ['app_progress', 'app_cancelled'],
        ['app_review', 'app_cancelled'],
        ['app_approval', 'app_cancelled'],
        // reopening
        ['app_done', 'app_todo'],
        ['app_cancelled', 'app_backlog'],
    ];

    /** The default workflow: free, so every transition is allowed. */
    public static function standard(): TransitionGraph
    {
        return new TransitionGraph(self::states(self::STANDARD_STATES), [], true, 'std_backlog');
    }

    /** An agency workflow with an internal review and a customer approval; only listed transitions are allowed. */
    public static function agency(): TransitionGraph
    {
        return new TransitionGraph(self::states(self::AGENCY_STATES), self::AGENCY_TRANSITIONS, false, 'app_backlog');
    }

    /** The workflow with every transition that leads into `$stateId` removed. */
    public static function withoutTransitionsInto(TransitionGraph $graph, string $stateId): TransitionGraph
    {
        return new TransitionGraph(
            $graph->states,
            array_values(array_filter($graph->transitions, fn (array $pair) => $pair[1] !== $stateId)),
            $graph->isFree,
            $graph->initialStateId,
        );
    }

    /**
     * The standard workflow as a client sends it (states with local ids).
     *
     * @return array<string, mixed>
     */
    public static function standardInput(string $name = 'Standard'): array
    {
        return [
            'name' => $name,
            'description' => 'Der Standard-Workflow: Jeder Status ist von überall erreichbar.',
            'is_default' => false,
            'is_free' => true,
            'initial_state_id' => 'std_backlog',
            'states' => self::STANDARD_STATES,
            'transitions' => [],
        ];
    }

    /**
     * The agency workflow as a client sends it (states with local ids).
     *
     * @return array<string, mixed>
     */
    public static function agencyInput(string $name = 'Agentur-Freigabe'): array
    {
        return [
            'name' => $name,
            'description' => 'Mit interner Prüfung und Kundenfreigabe vor dem Abschluss.',
            'is_default' => false,
            'is_free' => false,
            'initial_state_id' => 'app_backlog',
            'states' => self::AGENCY_STATES,
            'transitions' => self::AGENCY_TRANSITIONS,
        ];
    }

    /**
     * A saved workflow as the server answers it, which a client sends back to change it (`PUT` replaces it as a whole).
     *
     * @return array<string, mixed>
     */
    public static function inputOf(Workflow $workflow): array
    {
        return (new WorkflowResource($workflow->load(['states', 'transitions'])))->resolve();
    }

    /**
     * @param  list<array{id: string, name: string, icon: string, category: string}>  $rows
     * @return list<State>
     */
    private static function states(array $rows): array
    {
        return array_map(
            fn (array $row, int $position) => new State(
                $row['id'],
                $row['name'],
                StateIcon::from($row['icon']),
                StateCategory::from($row['category']),
                $position,
            ),
            $rows,
            array_keys($rows),
        );
    }
}
