<?php

use App\Domain\Notifications\EventFacts;
use App\Domain\Notifications\NotificationKind as Kind;
use App\Domain\Notifications\Recipient;
use App\Domain\Notifications\Recipients;
use App\Events\EventType;
use App\Support\NotificationFacts;

// people of the clickdummy, as plain IDs: ULIDs sort like these names
$ida = 'u_ida';
$lene = 'u_lene';
$mara = 'u_mara';
$noah = 'u_noah';
$tom = 'u_tom';

/** The facts of an event of WEB-47 (lead Mara, watched by Lene and Noah), changed by what the test passes. */
$facts = fn (string $type, array $with = []): EventFacts => new EventFacts(...[
    'type' => $type,
    'actorId' => $ida,
    'projectId' => 'p_web',
    'itemId' => 'wi_47',
    'changedFields' => [],
    'mentioned' => [],
    'assignee' => null,
    'watchers' => [$lene, $noah],
    'optedOut' => [],
    'leadId' => $mara,
    'stateSnapshot' => null,
    ...$with,
]);

/** The recipients as `user => kinds` (values), in the order of Recipients::of. */
$table = fn (array $recipients): array => array_combine(
    array_map(fn (Recipient $recipient) => $recipient->userId, $recipients),
    array_map(fn (Recipient $recipient) => array_map(fn (Kind $kind) => $kind->value, $recipient->kinds), $recipients),
);

it('tells watchers and the lead about a comment, never its writer', function () use ($facts, $table, $ida, $lene, $mara, $noah) {
    $recipients = Recipients::of($facts('comment.created', ['watchers' => [$ida, $lene, $noah]]));

    expect($table($recipients))->toBe([$lene => ['comment'], $mara => ['comment'], $noah => ['comment']]);
});

it('never tells the lead who wrote the comment', function () use ($facts, $table, $mara, $lene, $noah) {
    expect($table(Recipients::of($facts('comment.created', ['actorId' => $mara]))))->toBe([$lene => ['comment'], $noah => ['comment']]);
});

it('names the mentioned people mentioned, not again as comment', function () use ($facts, $table, $lene, $mara, $noah, $tom) {
    $recipients = Recipients::of($facts('comment.created', ['mentioned' => [$tom, $lene]]));

    expect($table($recipients))->toBe([
        $lene => ['mentioned', 'comment'],
        $mara => ['comment'],
        $noah => ['comment'],
        $tom => ['mentioned'],
    ])->and($recipients[0]->kinds[0])->toBe(Kind::Mentioned);
});

it('never tells the actor about a mention of themselves', function () use ($facts, $table, $ida, $lene) {
    expect($table(Recipients::of($facts('comment.updated', ['mentioned' => [$ida, $lene]]))))->toBe([$lene => ['mentioned']]);
});

it('tells the people mentioned in a description or a value', function () use ($facts, $table, $lene, $mara, $noah, $tom) {
    $recipients = Recipients::of($facts('work_item.updated', ['changedFields' => ['description'], 'mentioned' => [$tom]]));

    expect($table($recipients))->toBe([$lene => ['item_changed'], $mara => ['item_changed'], $noah => ['item_changed'], $tom => ['mentioned']]);
});

it('tells only the new assignee assigned, the others item_changed', function () use ($facts, $table, $lene, $mara, $noah) {
    $recipients = Recipients::of($facts('work_item.assigned', ['changedFields' => ['assignee_id'], 'assignee' => $noah]));

    expect($table($recipients))->toBe([$lene => ['item_changed'], $mara => ['item_changed'], $noah => ['assigned']]);
});

it('tells the watchers about an item that nobody is assigned to any more', function () use ($facts, $table, $lene, $mara, $noah) {
    expect($table(Recipients::of($facts('work_item.assigned', ['changedFields' => ['assignee_id']]))))
        ->toBe([$lene => ['item_changed'], $mara => ['item_changed'], $noah => ['item_changed']]);
});

it('never tells a person who takes an item themselves', function () use ($facts, $table, $ida, $lene, $mara, $noah) {
    expect($table(Recipients::of($facts('work_item.assigned', ['changedFields' => ['assignee_id'], 'assignee' => $ida]))))
        ->toBe([$lene => ['item_changed'], $mara => ['item_changed'], $noah => ['item_changed']]);
});

it('tells the lead about a new item, the assignee assigned', function () use ($facts, $table, $ida, $mara, $noah, $tom) {
    // the writer and the assignee watch a new item from its first moment: neither hears item_created
    $recipients = Recipients::of($facts('work_item.created', ['watchers' => [$ida, $noah], 'assignee' => $noah, 'mentioned' => [$tom]]));

    expect($table($recipients))->toBe([$mara => ['item_created'], $noah => ['assigned'], $tom => ['mentioned']]);
});

it('tells the lead both when the lead is the assignee of a new item', function () use ($facts, $table, $mara) {
    expect($table(Recipients::of($facts('work_item.created', ['watchers' => [], 'assignee' => $mara]))))->toBe([$mara => ['assigned', 'item_created']]);
});

it('tells nobody about a new item the lead creates without anybody in it', function () use ($facts, $mara) {
    expect(Recipients::of($facts('work_item.created', ['actorId' => $mara, 'watchers' => [$mara]])))->toBe([]);
});

it('tells watchers and the lead about a change of state', function () use ($facts, $table, $lene, $mara, $noah) {
    $snapshot = ['old' => ['id' => 's_todo', 'name' => 'Todo', 'category' => 'unstarted'], 'new' => ['id' => 's_doing', 'name' => 'In Progress', 'category' => 'started']];
    $recipients = Recipients::of($facts('work_item.state_changed', ['stateSnapshot' => $snapshot]));

    expect($table($recipients))->toBe([$lene => ['state_changed'], $mara => ['state_changed'], $noah => ['state_changed']]);
});

it('tells watchers and the lead about a change of fields', function () use ($facts, $table, $lene, $mara, $noah) {
    $recipients = Recipients::of($facts('work_item.updated', ['changedFields' => EventFacts::fieldsOf('work_item.updated', [
        'title' => ['old' => 'A', 'new' => 'B'],
        'values.customer' => ['old' => null, 'new' => 'o_1'],
    ])]));

    expect($table($recipients))->toBe([$lene => ['item_changed'], $mara => ['item_changed'], $noah => ['item_changed']]);
});

it('tells nobody about a change of rank alone', function () use ($facts) {
    $fields = EventFacts::fieldsOf('work_item.updated', ['rank' => ['old' => 'a0', 'new' => 'a1']]);

    expect($fields)->toBe([])
        ->and(Recipients::of($facts('work_item.updated', ['changedFields' => $fields])))->toBe([])
        ->and(Recipients::of($facts('work_item.updated', ['changedFields' => ['rank']])))->toBe([]);
});

it('takes the fields of a change without the rank, in the order of the change', function () {
    expect(EventFacts::fieldsOf('work_item.updated', [
        'title' => ['old' => 'A', 'new' => 'B'],
        'rank' => ['old' => 'a0', 'new' => 'a1'],
        'label_ids' => ['old' => [], 'new' => ['l_1']],
        'values.effort' => ['old' => 1, 'new' => 2],
    ]))->toBe(['title', 'label_ids', 'values.effort'])
        ->and(EventFacts::fieldsOf('work_item.updated', null))->toBe([])
        ->and(EventFacts::fieldsOf('work_item.created', ['title' => ['old' => null, 'new' => 'A']]))->toBe(['title']);
});

it('tells watchers about relations and attachments', function () use ($facts, $table, $lene, $mara, $noah) {
    $relation = EventFacts::fieldsOf('work_item.relation_added', ['relation' => ['old' => null, 'new' => ['item_id' => 'wi_12']]]);
    $removed = EventFacts::fieldsOf('work_item.relation_removed', ['relation' => ['old' => ['item_id' => 'wi_12'], 'new' => null]]);
    $attachment = EventFacts::fieldsOf('work_item.updated', ['attachments' => ['old' => null, 'new' => ['id' => 'a_1', 'filename' => 'plan.pdf']]]);
    $everyone = [$lene => ['item_changed'], $mara => ['item_changed'], $noah => ['item_changed']];

    expect([$relation, $removed, $attachment])->toBe([['relation'], ['relation'], ['attachment']])
        ->and($table(Recipients::of($facts('work_item.relation_added', ['changedFields' => $relation]))))->toBe($everyone)
        ->and($table(Recipients::of($facts('work_item.relation_removed', ['changedFields' => $removed]))))->toBe($everyone)
        ->and($table(Recipients::of($facts('work_item.updated', ['changedFields' => $attachment]))))->toBe($everyone);
});

it('keeps an opt-out away except for a mention and an assignment', function () use ($facts, $table, $lene, $mara, $noah) {
    // Noah and Lene unsubscribed: their rows have unsubscribed_at, so they are no watchers; Lene also stands in both lists
    $optedOut = ['watchers' => [$lene], 'optedOut' => [$lene, $noah]];

    expect($table(Recipients::of($facts('comment.created', $optedOut))))->toBe([$mara => ['comment']])
        ->and($table(Recipients::of($facts('work_item.state_changed', $optedOut))))->toBe([$mara => ['state_changed']])
        ->and($table(Recipients::of($facts('work_item.updated', [...$optedOut, 'changedFields' => ['title']]))))->toBe([$mara => ['item_changed']])
        ->and($table(Recipients::of($facts('comment.created', [...$optedOut, 'mentioned' => [$noah]]))))->toBe([$mara => ['comment'], $noah => ['mentioned']])
        ->and($table(Recipients::of($facts('work_item.assigned', [...$optedOut, 'changedFields' => ['assignee_id'], 'assignee' => $lene]))))
        ->toBe([$lene => ['assigned'], $mara => ['item_changed']]);
});

it('treats the lead as watcher unless the lead opted out', function () use ($facts, $table, $lene, $mara, $noah) {
    $watching = $table(Recipients::of($facts('comment.created', ['watchers' => []])));
    $optedOut = Recipients::of($facts('comment.created', ['watchers' => [$lene, $noah], 'optedOut' => [$mara]]));
    $noLead = $table(Recipients::of($facts('comment.created', ['leadId' => null])));

    expect($watching)->toBe([$mara => ['comment']])
        ->and($table($optedOut))->toBe([$lene => ['comment'], $noah => ['comment']])
        ->and($noLead)->toBe([$lene => ['comment'], $noah => ['comment']])
        ->and(Recipients::of($facts('work_item.created', ['watchers' => [], 'optedOut' => [$mara]])))->toBe([]);
});

it('names a watcher once, also when the lead watches too', function () use ($facts, $table, $lene, $mara) {
    expect($table(Recipients::of($facts('comment.created', ['watchers' => [$mara, $lene, $mara]]))))->toBe([$lene => ['comment'], $mara => ['comment']]);
});

it('passes archived, restored, deleted, subscribed, reactions, comment.deleted, bot and catalog events', function (string $type) use ($facts, $tom) {
    expect(Recipients::of($facts($type, ['changedFields' => ['archived_at'], 'mentioned' => [$tom], 'assignee' => $tom])))->toBe([]);
})->with([
    'work_item.archived', 'work_item.restored', 'work_item.deleted', 'work_item.subscribed', 'work_item.unsubscribed',
    'comment.reaction_added', 'comment.reaction_removed', 'comment.deleted', 'bot.created', 'workflow.updated',
    'label.created', 'project.updated', 'project.member_added', 'user.created', 'token.created', 'view.created', 'favorite.added',
]);

it('tells only newly mentioned people about an edited comment', function () use ($facts, $table, $tom) {
    // meta.mentioned of comment.updated names only the people mentioned anew (Mentions::meta)
    expect($table(Recipients::of($facts('comment.updated', ['mentioned' => [$tom]]))))->toBe([$tom => ['mentioned']])
        ->and(Recipients::of($facts('comment.updated')))->toBe([]);
});

it('sorts the recipients by their ID and the kinds by rank', function () use ($facts) {
    $recipients = Recipients::of($facts('comment.created', ['watchers' => ['u_c', 'u_a'], 'leadId' => 'u_b', 'mentioned' => ['u_b']]));

    expect(array_map(fn (Recipient $recipient) => $recipient->userId, $recipients))->toBe(['u_a', 'u_b', 'u_c'])
        ->and($recipients[1]->kinds)->toBe([Kind::Mentioned, Kind::Comment]);
});

it('tells somebody for exactly the events NotificationFacts reads (T5-M2)', function () use ($facts, $tom) {
    $telling = array_map(fn (EventType $type) => $type->value, NotificationFacts::TELLING);

    foreach (EventType::cases() as $type) {
        // as much as an event can carry: a changed field, a mention, an assignee, watchers and a lead
        $recipients = Recipients::of($facts($type->value, ['changedFields' => ['title'], 'mentioned' => [$tom], 'assignee' => $tom]));

        expect($recipients !== [])->toBe(in_array($type->value, $telling, true), $type->value);
    }
});

it('tells the lead and the author of a template about a failed run', function () use ($facts, $table, $mara, $tom) {
    // a scheduled run: the default bot acts, no item, nobody watches
    $failed = $facts('template.run_failed', ['actorId' => 'u_bot', 'itemId' => null, 'watchers' => [], 'templateAuthorId' => $tom]);

    expect($table(Recipients::of($failed)))->toBe([$mara => ['template_run_failed'], $tom => ['template_run_failed']]);
});

it('tells nobody twice when the lead wrote the template', function () use ($facts, $table, $mara) {
    $failed = $facts('template.run_failed', ['actorId' => 'u_bot', 'itemId' => null, 'watchers' => [], 'templateAuthorId' => $mara]);

    expect($table(Recipients::of($failed)))->toBe([$mara => ['template_run_failed']]);
});

it('tells only the lead and the author about a failed run, whatever else the facts carry', function () use ($facts, $table, $mara, $tom) {
    $failed = $facts('template.run_failed', ['actorId' => 'u_bot', 'mentioned' => ['u_x'], 'assignee' => 'u_y', 'changedFields' => ['title'], 'templateAuthorId' => $tom]);

    expect($table(Recipients::of($failed)))->toBe([$mara => ['template_run_failed'], $tom => ['template_run_failed']])
        ->and(Recipients::of($facts('template.run_failed', ['leadId' => null, 'templateAuthorId' => null])))->toBe([]);
});

it('leaves out who the automation acted for', function () use ($facts, $table, $lene, $mara, $noah) {
    // "Assignee beim Start": the default bot assigns Noah, who started the item; Noah hears nothing of his own move
    $assigned = $facts('work_item.assigned', ['actorId' => 'u_bot', 'assignee' => $noah, 'causedBy' => $noah]);

    expect($table(Recipients::of($assigned)))->toBe([$lene => ['item_changed'], $mara => ['item_changed']]);
});

it('leaves out who ran the template now (K12)', function () use ($facts, $table, $tom) {
    // Mara, lead of WEB, pressed "run now" on Tom's template: only Tom hears of it
    $failed = $facts('template.run_failed', ['actorId' => 'u_bot', 'itemId' => null, 'watchers' => [], 'templateAuthorId' => $tom, 'causedBy' => 'u_mara']);

    expect($table(Recipients::of($failed)))->toBe([$tom => ['template_run_failed']]);
});
