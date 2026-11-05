<?php

use App\Domain\Filter\InvalidInput;
use App\Domain\Webhooks\EventPatterns;
use App\Events\EventType;

// the catalog as the callers pass it: the values of every event type a webhook can subscribe to, in their order
$catalog = array_values(array_map(
    fn (EventType $type) => $type->value,
    array_filter(EventType::cases(), fn (EventType $type) => $type->webhook()),
));
$workItems = array_values(array_filter($catalog, fn (string $event) => str_starts_with($event, 'work_item.')));

it('stores a fully ticked group as its wildcard', function () use ($catalog, $workItems) {
    expect($workItems)->toHaveCount(9)
        ->and(EventPatterns::normalize($workItems, $catalog))->toBe(['work_item.*'])
        ->and(EventPatterns::normalize([...array_reverse($workItems), 'comment.created'], $catalog))->toBe(['work_item.*', 'comment.created'])
        // a wildcard next to single names of its group stays the wildcard alone
        ->and(EventPatterns::normalize(['bot.mentioned', 'bot.*', 'bot.assigned'], $catalog))->toBe(['bot.*'])
        ->and(EventPatterns::normalize(['bot.mentioned', 'bot.assigned'], $catalog))->toBe(['bot.*'])
        ->and(EventPatterns::normalize(['template.run_failed'], $catalog))->toBe(['template.*'])
        ->and(EventPatterns::normalize([], $catalog))->toBe([]);
});

it('keeps single events in the order of the catalog', function () use ($catalog) {
    expect(EventPatterns::normalize(
        ['page.deleted', 'work_item.state_changed', 'project.created', 'page.created', 'work_item.created', 'page.deleted'],
        $catalog,
    ))->toBe(['project.created', 'work_item.created', 'work_item.state_changed', 'page.created', 'page.deleted'])
        ->and(EventPatterns::normalize(['comment.*', 'project.*'], $catalog))->toBe(['project.*', 'comment.*']);
});

it('refuses an event outside the catalog', function (string $name) use ($catalog) {
    try {
        EventPatterns::normalize(['work_item.created', $name, 'nope.other'], $catalog);
        $this->fail('normalize took '.$name);
    } catch (InvalidInput $e) {
        // the first unknown name, nothing else
        expect($e->errors)->toBe(['events' => 'unknown:'.$name]);
    }
})->with([
    'an event without webhook' => ['workflow.updated'],
    'a comment reaction' => ['comment.reaction_added'],
    'a wildcard with a tail' => ['page.*x'],
    'the wildcard of an unknown group' => ['nope.*'],
    'a group without a dot' => ['work_item'],
    'a bare wildcard' => ['*'],
    'a name in capitals' => ['WORK_ITEM.CREATED'],
    'an empty name' => [''],
]);

it('matches a wildcard and a single name', function () use ($catalog) {
    expect(EventPatterns::matches(['work_item.*'], 'work_item.state_changed', $catalog))->toBeTrue()
        ->and(EventPatterns::matches(['work_item.*'], 'comment.created', $catalog))->toBeFalse()
        ->and(EventPatterns::matches(['page.created', 'comment.deleted'], 'comment.deleted', $catalog))->toBeTrue()
        ->and(EventPatterns::matches(['page.created'], 'page.updated', $catalog))->toBeFalse()
        ->and(EventPatterns::matches([], 'page.created', $catalog))->toBeFalse()
        // the group is the part before the first dot, never a prefix of the name
        ->and(EventPatterns::matches(['work.*'], 'work_item.created', $catalog))->toBeFalse();
});

it('does not let comment.* match comment.reaction_added', function () use ($catalog) {
    expect(in_array('comment.reaction_added', $catalog, true))->toBeFalse()
        ->and(EventPatterns::matches(['comment.*'], 'comment.reaction_added', $catalog))->toBeFalse()
        ->and(EventPatterns::matches(['comment.reaction_added'], 'comment.reaction_added', $catalog))->toBeFalse()
        ->and(EventPatterns::matches(['comment.*'], 'comment.created', $catalog))->toBeTrue();
});

it('expands the patterns to the events of the catalog', function () use ($catalog, $workItems) {
    expect(EventPatterns::expand(['work_item.*'], $catalog))->toBe($workItems)
        ->and(EventPatterns::expand(['bot.assigned', 'project.*', 'bot.mentioned'], $catalog))->toBe([
            'project.created', 'project.updated', 'project.archived', 'project.restored', 'project.deleted',
            'project.member_added', 'project.member_removed', 'bot.mentioned', 'bot.assigned',
        ])
        ->and(EventPatterns::expand(['comment.*', 'comment.created'], $catalog))->toBe(['comment.created', 'comment.updated', 'comment.deleted'])
        // what is not in the catalog (any longer) stands for nothing
        ->and(EventPatterns::expand(['nope.*', 'workflow.updated'], $catalog))->toBe([]);
});

it('reads its own normal form back', function () use ($catalog) {
    $stored = EventPatterns::normalize(['project.*', 'work_item.created', 'page.moved'], $catalog);

    expect(EventPatterns::normalize(EventPatterns::expand($stored, $catalog), $catalog))->toBe($stored);
});
