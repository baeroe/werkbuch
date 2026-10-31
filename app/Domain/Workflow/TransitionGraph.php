<?php

namespace App\Domain\Workflow;

/**
 * The rules of a workflow (spec 4.5): which transitions are allowed, and whether the workflow can be saved.
 * A free workflow allows every state of the workflow from everywhere; any other one only the listed pairs.
 */
final readonly class TransitionGraph
{
    /**
     * @param  list<State>  $states
     * @param  list<array{0: string, 1: string}>  $transitions
     */
    public function __construct(
        public array $states,
        public array $transitions,
        public bool $isFree,
        public ?string $initialStateId,
    ) {}

    /**
     * The states by position.
     *
     * @return list<State>
     */
    public function statesInOrder(): array
    {
        $states = $this->states;
        usort($states, fn (State $a, State $b) => $a->position <=> $b->position);

        return $states;
    }

    /**
     * Whether an item may move from one state to another. Staying in the same state is a no-op and always allowed.
     */
    public function canTransition(string $from, string $to): bool
    {
        if ($from === $to) {
            return true;
        }

        if (! $this->has($to)) {
            return false;
        }

        if ($this->isFree) {
            return true;
        }

        foreach ($this->transitions as [$transitionFrom, $transitionTo]) {
            if ($transitionFrom === $from && $transitionTo === $to) {
                return true;
            }
        }

        return false;
    }

    /**
     * The states an item in `$from` can move to, by position, without `$from` itself.
     *
     * @return list<State>
     */
    public function allowedTargets(string $from): array
    {
        return array_values(array_filter(
            $this->statesInOrder(),
            fn (State $state) => $state->id !== $from && $this->canTransition($from, $state->id),
        ));
    }

    /**
     * What stops the workflow from being saved: it needs a start state that is one of its states, at least one
     * Completed state, and every state must be reachable from the start state. A free workflow reaches everything.
     * Without a start state reachability cannot be judged, so it is not reported.
     *
     * @return list<WorkflowIssue>
     */
    public function issues(): array
    {
        $issues = [];

        $hasInitialState = $this->initialStateId !== null && $this->has($this->initialStateId);

        if (! $hasInitialState) {
            $issues[] = new WorkflowIssue(IssueCode::NoInitialState);
        }

        if (! array_filter($this->states, fn (State $state) => $state->category === StateCategory::Completed)) {
            $issues[] = new WorkflowIssue(IssueCode::NoCompletedState);
        }

        if ($hasInitialState && ! $this->isFree) {
            $reachable = $this->reachableFrom((string) $this->initialStateId);

            foreach ($this->statesInOrder() as $state) {
                if (! isset($reachable[$state->id])) {
                    $issues[] = new WorkflowIssue(IssueCode::UnreachableState, $state->id);
                }
            }
        }

        return $issues;
    }

    private function has(string $stateId): bool
    {
        foreach ($this->states as $state) {
            if ($state->id === $stateId) {
                return true;
            }
        }

        return false;
    }

    /**
     * The ids of the states reachable from `$start` over the listed transitions, as keys. Transitions into states
     * that no longer exist lead nowhere.
     *
     * @return array<string, true>
     */
    private function reachableFrom(string $start): array
    {
        $reached = [$start => true];
        $queue = [$start];

        while ($queue !== []) {
            $current = array_shift($queue);

            foreach ($this->transitions as [$from, $to]) {
                if ($from === $current && ! isset($reached[$to]) && $this->has($to)) {
                    $reached[$to] = true;
                    $queue[] = $to;
                }
            }
        }

        return $reached;
    }
}
