<?php

use App\Domain\Automations\AssignOnStartRule;
use App\Domain\Workflow\StateCategory as C;

it('assigns a person who starts an item without an assignee', function () {
    expect(AssignOnStartRule::applies(true, null, C::Unstarted, C::Started))->toBeTrue()
        ->and(AssignOnStartRule::applies(true, null, C::Backlog, C::Started))->toBeTrue()
        ->and(AssignOnStartRule::applies(true, null, C::Completed, C::Started))->toBeTrue();
});

it('leaves a bot out', function () {
    expect(AssignOnStartRule::applies(false, null, C::Unstarted, C::Started))->toBeFalse();
});

it('keeps an assignee', function () {
    expect(AssignOnStartRule::applies(true, 'user-1', C::Unstarted, C::Started))->toBeFalse();
});

it('does nothing when the item was started already', function () {
    expect(AssignOnStartRule::applies(true, null, C::Started, C::Started))->toBeFalse();
});

it('does nothing for a move that does not start the item', function () {
    expect(AssignOnStartRule::applies(true, null, C::Backlog, C::Completed))->toBeFalse()
        ->and(AssignOnStartRule::applies(true, null, C::Started, C::Unstarted))->toBeFalse();
});
