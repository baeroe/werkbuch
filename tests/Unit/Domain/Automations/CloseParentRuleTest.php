<?php

use App\Domain\Automations\CloseParentRule;
use App\Domain\Workflow\State;
use App\Domain\Workflow\StateCategory as C;
use App\Domain\Workflow\StateIcon;
use App\Domain\Workflow\TransitionGraph;

$graph = function (array $categories, array $transitions, bool $free = false): TransitionGraph {
    $states = [];
    foreach ($categories as $id => $category) {
        $states[] = new State($id, $id, StateIcon::Circle, $category, count($states));
    }

    return new TransitionGraph($states, $transitions, $free, array_key_first($categories));
};

it('closes when every child is closed and one is completed', function () {
    expect(CloseParentRule::closes([C::Completed, C::Canceled], C::Started))->toBeTrue()
        ->and(CloseParentRule::closes([C::Completed], C::Backlog))->toBeTrue();
});

it('stays open when all children are canceled', function () {
    expect(CloseParentRule::closes([C::Canceled, C::Canceled], C::Started))->toBeFalse();
});

it('stays open while a child is open', function () {
    expect(CloseParentRule::closes([C::Completed, C::Started], C::Started))->toBeFalse();
});

it('stays open for a parent without children', function () {
    expect(CloseParentRule::closes([], C::Started))->toBeFalse();
});

it('does nothing for a closed parent', function () {
    expect(CloseParentRule::closes([C::Completed], C::Completed))->toBeFalse()
        ->and(CloseParentRule::closes([C::Completed], C::Canceled))->toBeFalse();
});

it('limits the chain upwards to five levels', function () {
    expect(CloseParentRule::MAX_CHAIN)->toBe(5);
});

it('takes the first completed state the workflow allows', function () use ($graph) {
    $g = $graph(['todo' => C::Unstarted, 'doing' => C::Started, 'review' => C::Completed, 'done' => C::Completed], [
        ['todo', 'doing'], ['doing', 'done'],
    ]);
    $order = [
        ['id' => 'todo', 'category' => C::Unstarted],
        ['id' => 'doing', 'category' => C::Started],
        ['id' => 'review', 'category' => C::Completed],
        ['id' => 'done', 'category' => C::Completed],
    ];

    expect(CloseParentRule::target($order, 'doing', $g))->toBe('done');
    $free = $graph(['todo' => C::Unstarted, 'review' => C::Completed, 'done' => C::Completed], [], true);
    $freeOrder = [
        ['id' => 'todo', 'category' => C::Unstarted],
        ['id' => 'review', 'category' => C::Completed],
        ['id' => 'done', 'category' => C::Completed],
    ];

    expect(CloseParentRule::target($freeOrder, 'todo', $free))->toBe('review');
});

it('answers null when no completed state is reachable', function () use ($graph) {
    $g = $graph(['todo' => C::Unstarted, 'doing' => C::Started, 'done' => C::Completed], [['todo', 'doing']]);
    $order = [
        ['id' => 'todo', 'category' => C::Unstarted],
        ['id' => 'doing', 'category' => C::Started],
        ['id' => 'done', 'category' => C::Completed],
    ];

    expect(CloseParentRule::target($order, 'doing', $g))->toBeNull();
});
