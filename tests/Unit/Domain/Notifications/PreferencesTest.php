<?php

use App\Domain\Notifications\Channel;
use App\Domain\Notifications\NotificationKind as Kind;
use App\Domain\Notifications\Preferences;

it('has the inbox on and mail on for assigned, mentioned, comment and due by default', function () {
    $mail = array_values(array_filter(Kind::ORDER, fn (Kind $kind) => Preferences::enabled($kind, Channel::Mail, [])));
    $inbox = array_values(array_filter(Kind::ORDER, fn (Kind $kind) => Preferences::enabled($kind, Channel::Inbox, [])));

    expect($mail)->toBe([Kind::Assigned, Kind::Mentioned, Kind::Comment, Kind::Due])
        ->and($inbox)->toBe(Kind::ORDER);
});

it('takes a stored choice over the default', function () {
    $stored = ['assigned:mail' => false, 'state_changed:mail' => true, 'comment:inbox' => false, 'due:inbox' => true];

    expect(Preferences::enabled(Kind::Assigned, Channel::Mail, $stored))->toBeFalse()
        ->and(Preferences::enabled(Kind::StateChanged, Channel::Mail, $stored))->toBeTrue()
        ->and(Preferences::enabled(Kind::Comment, Channel::Inbox, $stored))->toBeFalse()
        ->and(Preferences::enabled(Kind::Comment, Channel::Mail, $stored))->toBeTrue()
        ->and(Preferences::enabled(Kind::Due, Channel::Inbox, $stored))->toBeTrue()
        ->and(Preferences::enabled(Kind::Mentioned, Channel::Inbox, $stored))->toBeTrue();
});

it('names the nine kinds in the order of the clickdummy and ranks them for one entry per person', function () {
    $byRank = Kind::ORDER;
    usort($byRank, fn (Kind $a, Kind $b) => $a->rank() <=> $b->rank());

    expect(array_map(fn (Kind $kind) => $kind->value, Kind::ORDER))->toBe([
        'assigned', 'mentioned', 'comment', 'state_changed', 'item_changed', 'due', 'item_created', 'template_run_failed', 'webhook_disabled',
    ])->and(Kind::ORDER)->toHaveCount(count(Kind::cases()))
        ->and(array_map(fn (Kind $kind) => $kind->value, $byRank))->toBe([
            'mentioned', 'assigned', 'comment', 'state_changed', 'item_changed', 'due', 'item_created', 'template_run_failed', 'webhook_disabled',
        ])->and(array_map(fn (Kind $kind) => $kind->rank(), $byRank))->toBe(range(1, 9))
        ->and(array_map(fn (Channel $channel) => $channel->value, Channel::cases()))->toBe(['inbox', 'mail']);
});
