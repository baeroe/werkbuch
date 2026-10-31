<?php

use App\Domain\Workflow\IssueCode;
use App\Domain\Workflow\State;
use App\Domain\Workflow\StateCategory;
use App\Domain\Workflow\TransitionGraph;
use App\Domain\Workflow\WorkflowIssue;
use Tests\Support\WorkflowFixtures;

describe('canTransition', function () {
    it('rejects a transition the matrix does not list (todo to done in Agentur-Freigabe)', function () {
        expect(WorkflowFixtures::agency()->canTransition('app_todo', 'app_done'))->toBeFalse();
    });

    it('allows a listed transition (Kundenfreigabe to done)', function () {
        expect(WorkflowFixtures::agency()->canTransition('app_approval', 'app_done'))->toBeTrue();
    });

    it('allows an open status to move to cancelled', function () {
        expect(WorkflowFixtures::agency()->canTransition('app_progress', 'app_cancelled'))->toBeTrue();
    });

    it('allows every transition in a free workflow', function () {
        expect(WorkflowFixtures::standard()->canTransition('std_todo', 'std_done'))->toBeTrue();
    });

    it('treats staying in the same status as an allowed no-op', function () {
        expect(WorkflowFixtures::agency()->canTransition('app_review', 'app_review'))->toBeTrue();
    });

    it('reopens a closed item only through the listed transitions', function () {
        $agency = WorkflowFixtures::agency();

        expect($agency->canTransition('app_done', 'app_todo'))->toBeTrue()
            ->and($agency->canTransition('app_done', 'app_cancelled'))->toBeFalse()
            ->and($agency->canTransition('app_cancelled', 'app_backlog'))->toBeTrue();
    });

    it('rejects a target that is not a status of the workflow, even in a free workflow', function () {
        expect(WorkflowFixtures::standard()->canTransition('std_todo', 'app_done'))->toBeFalse();
    });
});

describe('allowedTargets', function () {
    $stateIds = fn (array $states) => array_map(fn (State $state) => $state->id, $states);

    it('lists the statuses reachable from review, in the order of the workflow, without review itself', function () use ($stateIds) {
        expect($stateIds(WorkflowFixtures::agency()->allowedTargets('app_review')))
            ->toBe(['app_progress', 'app_approval', 'app_cancelled']);
    });

    it('offers only the listed transitions of todo (progress and cancelled)', function () use ($stateIds) {
        expect($stateIds(WorkflowFixtures::agency()->allowedTargets('app_todo')))->toBe(['app_progress', 'app_cancelled']);
    });

    it('offers every other status in a free workflow', function () use ($stateIds) {
        expect($stateIds(WorkflowFixtures::standard()->allowedTargets('std_todo')))
            ->toBe(['std_backlog', 'std_progress', 'std_pending', 'std_done', 'std_cancelled']);
    });

    it('orders by position, not by the order of the states array', function () use ($stateIds) {
        $agency = WorkflowFixtures::agency();
        $shuffled = new TransitionGraph(array_reverse($agency->states), $agency->transitions, $agency->isFree, $agency->initialStateId);

        expect($stateIds($shuffled->allowedTargets('app_review')))->toBe(['app_progress', 'app_approval', 'app_cancelled'])
            ->and($stateIds($shuffled->statesInOrder()))->toBe($stateIds($agency->states));
    });
});

describe('issues', function () {
    $issueArrays = fn (array $issues) => array_map(fn (WorkflowIssue $issue) => $issue->toArray(), $issues);

    it('finds nothing wrong with the shipped workflows', function () {
        expect(WorkflowFixtures::standard()->issues())->toBe([])
            ->and(WorkflowFixtures::agency()->issues())->toBe([]);
    });

    it('reports a workflow without a completed status', function () use ($issueArrays) {
        $agency = WorkflowFixtures::agency();
        $graph = new TransitionGraph(
            array_values(array_filter($agency->states, fn (State $s) => $s->category !== StateCategory::Completed)),
            $agency->transitions,
            $agency->isFree,
            $agency->initialStateId,
        );

        expect($issueArrays($graph->issues()))->toContain(['code' => 'no_completed_state']);
    });

    it('reports a status that no transition leads to as unreachable', function () use ($issueArrays) {
        $graph = WorkflowFixtures::withoutTransitionsInto(WorkflowFixtures::agency(), 'app_review');

        expect($issueArrays($graph->issues()))->toContain(['code' => 'unreachable_state', 'state_id' => 'app_review']);
    });

    it('reports everything behind the unreachable status as unreachable too', function () use ($issueArrays) {
        $issues = $issueArrays(WorkflowFixtures::withoutTransitionsInto(WorkflowFixtures::agency(), 'app_review')->issues());

        // Kundenfreigabe and Done can only be reached through Review
        expect($issues)->toContain(['code' => 'unreachable_state', 'state_id' => 'app_approval'])
            ->toContain(['code' => 'unreachable_state', 'state_id' => 'app_done'])
            ->not->toContain(['code' => 'unreachable_state', 'state_id' => 'app_progress']);
    });

    it('reports an initial status that is not part of the workflow, and nothing else about reachability', function () use ($issueArrays) {
        $agency = WorkflowFixtures::agency();
        $graph = new TransitionGraph($agency->states, $agency->transitions, $agency->isFree, 'gone');

        expect($issueArrays($graph->issues()))->toBe([['code' => 'no_initial_state']]);
    });

    it('reports a workflow without any initial status', function () {
        $agency = WorkflowFixtures::agency();
        $graph = new TransitionGraph($agency->states, $agency->transitions, $agency->isFree, null);

        expect($graph->issues()[0]->code)->toBe(IssueCode::NoInitialState)
            ->and($graph->issues())->toHaveCount(1);
    });

    it('does not check reachability in a free workflow', function () {
        $standard = WorkflowFixtures::standard();

        expect((new TransitionGraph($standard->states, [], true, $standard->initialStateId))->issues())->toBe([]);
    });

    it('checks reachability when the workflow is not free, even without transitions', function () use ($issueArrays) {
        $standard = WorkflowFixtures::standard();
        $graph = new TransitionGraph($standard->states, [], false, $standard->initialStateId);

        expect(array_column($issueArrays($graph->issues()), 'state_id'))
            ->toBe(['std_todo', 'std_progress', 'std_pending', 'std_done', 'std_cancelled']);
    });

    it('ignores transitions that point at statuses which no longer exist', function () use ($issueArrays) {
        $agency = WorkflowFixtures::agency();
        $withoutDone = new TransitionGraph(
            array_values(array_filter($agency->states, fn (State $s) => $s->id !== 'app_done')),
            $agency->transitions,
            $agency->isFree,
            $agency->initialStateId,
        );
        $issues = $issueArrays($withoutDone->issues());

        expect($issues)->toContain(['code' => 'no_completed_state'])
            ->and(array_column($issues, 'code'))->not->toContain('unreachable_state');
    });
});

describe('categories', function () {
    it('is closed for completed and canceled only', function () {
        expect(array_map(fn (StateCategory $category) => $category->isClosed(), StateCategory::ORDER))
            ->toBe([false, false, false, true, true]);
    });

    it('lists the categories in the order of boards and lists', function () {
        expect(array_map(fn (StateCategory $category) => $category->value, StateCategory::ORDER))
            ->toBe(['backlog', 'unstarted', 'started', 'completed', 'canceled'])
            ->and(StateCategory::ORDER)->toHaveCount(count(StateCategory::cases()));
    });
});

describe('WorkflowIssue', function () {
    it('leaves the state out of an issue without one', function () {
        expect((new WorkflowIssue(IssueCode::NoCompletedState))->toArray())->toBe(['code' => 'no_completed_state']);
    });

    it('names the state of an issue that has one', function () {
        expect((new WorkflowIssue(IssueCode::UnreachableState, 'app_done'))->toArray())
            ->toBe(['code' => 'unreachable_state', 'state_id' => 'app_done']);
    });
});
