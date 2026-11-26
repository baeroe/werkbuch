<?php

use App\Domain\Workflow\AgentStep;
use App\Domain\Workflow\StateCategory;

/*
 * The steps of the agents on a workflow (spec 7.4): which state category each takes.
 */

it('takes a started state for working and review, backlog or unstarted for a correction, completed for merged', function () {
    expect(AgentStep::Working->fits(StateCategory::Started))->toBeTrue()
        ->and(AgentStep::Working->fits(StateCategory::Unstarted))->toBeFalse()
        ->and(AgentStep::Review->fits(StateCategory::Started))->toBeTrue()
        ->and(AgentStep::Review->fits(StateCategory::Completed))->toBeFalse()
        ->and(AgentStep::Correction->fits(StateCategory::Backlog))->toBeTrue()
        ->and(AgentStep::Correction->fits(StateCategory::Unstarted))->toBeTrue()
        ->and(AgentStep::Correction->fits(StateCategory::Started))->toBeFalse()
        ->and(AgentStep::Merged->fits(StateCategory::Completed))->toBeTrue()
        ->and(AgentStep::Merged->fits(StateCategory::Canceled))->toBeFalse();
});

it('names the four steps in the order of the flow', function () {
    expect(AgentStep::KEYS)->toBe(['working', 'review', 'correction', 'merged'])
        ->and(array_column(AgentStep::cases(), 'value'))->toBe([...AgentStep::KEYS, 'ready', 'blocked']);
});

it('reads stored steps leniently: every step once, a state id or null', function () {
    expect(AgentStep::read(null))->toBe(['working' => null, 'review' => null, 'correction' => null, 'merged' => null, 'ready' => null, 'blocked' => null])
        ->and(AgentStep::read(['review' => 'st_a', 'merged' => 3, 'nope' => 'x']))->toBe(['working' => null, 'review' => 'st_a', 'correction' => null, 'merged' => null, 'ready' => null, 'blocked' => null])
        ->and(AgentStep::complete(['working' => 'a', 'review' => 'b', 'correction' => 'c', 'merged' => null]))->toBeFalse()
        ->and(AgentStep::complete(['working' => 'a', 'review' => 'b', 'correction' => 'c', 'merged' => 'd']))->toBeTrue()
        ->and(AgentStep::complete(['working' => 'a', 'review' => 'b', 'correction' => 'c', 'merged' => 'd', 'ready' => null, 'blocked' => null]))->toBeTrue();
});

it('takes Pending as an optional step of the category started (WEBU-50)', function () {
    $steps = ['working' => 'a', 'review' => 'b', 'correction' => 'c', 'merged' => 'd'];

    expect(AgentStep::Blocked->fits(StateCategory::Started))->toBeTrue()->and(AgentStep::Blocked->fits(StateCategory::Unstarted))->toBeFalse()
        ->and(AgentStep::read($steps)['blocked'])->toBeNull()->and(AgentStep::complete($steps))->toBeTrue();
});
