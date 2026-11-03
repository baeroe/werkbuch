<?php

use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Actions\WorkItems\ChangeWorkItemType;
use App\Actions\WorkItems\CreateWorkItem;
use App\Actions\WorkItems\UpdateWorkItem;
use App\Domain\Properties\FieldType;
use App\Events\EventType;
use App\Models\Attachment;
use App\Models\Project;
use App\Models\Property;
use App\Models\User;
use App\Models\WorkItem;
use App\Models\WorkItemSubscriber;
use App\Models\WorkItemType;
use Tests\Support\RichTextFixtures as F;

/*
 * What saving an item's rich text does under the lock (Task 8): uploads become the item's, mentioned people watch it,
 * `meta.mentioned` names only who is mentioned anew, bots get `bot.mentioned`. WEB with Mara as its admin, Lene and
 * the bot Kira as members; Ida is in the organization only.
 */

$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara', 'handle' => 'mara']);
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $lene = memberOf($web, ProjectRole::Member, ['name' => 'Lene', 'handle' => 'lene']);
    $kira = User::factory()->bot($mara)->create(['name' => 'Kira', 'handle' => 'kira']);
    app(RoleAssignments::class)->setProjectRole($kira, $web, ProjectRole::Member);

    return compact('mara', 'web', 'lene', 'kira');
};

/** A rich text property `notes` on the Task type. */
$notes = function (): Property {
    $property = Property::factory()->create(['key' => 'notes', 'label' => 'Notizen', 'field_type' => FieldType::RichText]);
    $task = WorkItemType::query()->where('name', 'Task')->firstOrFail();
    $task->typeProperties()->create(['property_id' => $property->id, 'required' => false, 'position' => $task->typeProperties()->count()]);

    return $property;
};

$create = fn (User $user, Project $project, array $input): WorkItem => CreateWorkItem::run(actor($user), ['project_id' => $project->id, 'title' => 'Formular prüfen', ...$input]);
$update = fn (User $user, WorkItem $item, array $input): WorkItem => UpdateWorkItem::run(actor($user), $item, $input);

it('links the unowned uploads of the writer when an item is created and when its description changes', function () use ($world, $create, $update) {
    $w = $world();
    $first = Attachment::factory()->create(['project_id' => $w['web']->id, 'uploaded_by' => $w['mara']->id]);
    $second = Attachment::factory()->create(['project_id' => $w['web']->id, 'uploaded_by' => $w['mara']->id]);
    $other = WorkItem::factory()->for($w['web'])->create();
    $owned = Attachment::factory()->forItem($other)->create(['uploaded_by' => $w['lene']->id]);

    $item = $create($w['mara'], $w['web'], ['description_json' => F::doc(F::image($first->id, null), F::image($owned->id, null))]);
    $update($w['mara'], $item, ['description' => "![a](attachment:{$first->id})\n\n![b](attachment:{$second->id})"]);

    expect(Attachment::query()->whereKey([$first->id, $second->id])->pluck('attachable_id')->all())->toBe([$item->id, $item->id])
        // a picture another text of the project owns stays with it (A233)
        ->and($owned->fresh()?->attachable_id)->toBe($other->id);
});

it('subscribes a newly mentioned person and lifts their opt-out', function () use ($world, $create, $update) {
    $w = $world();
    $item = $create($w['mara'], $w['web'], []);
    WorkItemSubscriber::query()->create(['work_item_id' => $item->id, 'user_id' => $w['lene']->id, 'reason' => 'manual', 'unsubscribed_at' => now()]);

    $update($w['mara'], $item, ['description' => 'Bitte @lene und @mara ansehen.']);
    $rows = WorkItemSubscriber::query()->where('work_item_id', $item->id)->get()->keyBy('user_id');

    expect($rows[$w['lene']->id]->only(['reason', 'unsubscribed_at']))->toBe(['reason' => 'mentioned', 'unsubscribed_at' => null])
        // who watches already keeps the reason
        ->and($rows[$w['mara']->id]->reason)->toBe('created')
        ->and($rows->has($w['kira']->id))->toBeFalse();

    // only a new mention lifts an opt-out: keeping the mention does not
    $rows[$w['lene']->id]->update(['unsubscribed_at' => now()]);
    $update($w['mara'], $item, ['description' => 'Bitte @lene und @mara jetzt ansehen.']);
    expect($rows[$w['lene']->id]->fresh()?->unsubscribed_at)->not->toBeNull();
});

it('names only newly mentioned people in meta.mentioned', function () use ($world, $create, $update) {
    $w = $world();
    $item = $create($w['lene'], $w['web'], ['description' => 'Hallo @mara']);

    $update($w['lene'], $item, ['description' => 'Hallo @mara und @lene']);
    $update($w['mara'], $item, ['description' => 'Hallo @mara, @lene und @kira']);
    $update($w['mara'], $item, ['title' => 'Formular freigeben']);
    [$created] = eventsOf(EventType::WorkItemCreated, $item)->all();
    [$selfMention, $mentioning, $renamed] = eventsOf(EventType::WorkItemUpdated, $item)->all();

    expect($created->meta['mentioned'])->toBe([$w['mara']->id])
        // Lene mentions herself: that is nobody (A259)
        ->and($selfMention->meta)->not->toHaveKey('mentioned')
        // Lene is named already: only Kira is new
        ->and($mentioning->meta['mentioned'])->toBe([$w['kira']->id])
        ->and($renamed->meta)->not->toHaveKey('mentioned');
});

it('does not count a writer who mentions themselves in the description or a value (A259)', function () use ($world, $notes, $create, $update) {
    $w = $world();
    $notes();
    $item = $create($w['mara'], $w['web'], []);
    WorkItemSubscriber::query()->create(['work_item_id' => $item->id, 'user_id' => $w['lene']->id, 'reason' => 'manual', 'unsubscribed_at' => now()]);

    $update($w['lene'], $item, ['description' => 'Merke ich mir, @lene.']);
    $update($w['lene'], $item, ['values' => ['notes' => 'Auch hier @lene und @mara']]);
    $events = eventsOf(EventType::WorkItemUpdated, $item)->all();

    expect(WorkItemSubscriber::query()->where('work_item_id', $item->id)->where('user_id', $w['lene']->id)->value('unsubscribed_at'))->not->toBeNull()
        ->and($events[0]->meta)->not->toHaveKey('mentioned')
        ->and($events[1]->meta['mentioned'])->toBe([$w['mara']->id]);

    // a bot that mentions itself in a description gets no bot.mentioned
    $other = $create($w['kira'], $w['web'], ['description' => 'Von @kira angelegt.']);
    expect(eventsOf(EventType::BotMentioned, $other))->toBeEmpty()
        ->and(eventsOf(EventType::WorkItemCreated, $other)->sole()->meta)->not->toHaveKey('mentioned');
});

it('records bot.mentioned for a mentioned bot member, nothing for the default bot unless it is a member', function () use ($world, $create, $update) {
    $w = $world();
    $default = User::defaultBot();
    $item = $create($w['mara'], $w['web'], ['description' => '@kira und @'.$default->handle]);

    $mentioned = eventsOf(EventType::BotMentioned, $item)->sole();
    expect($mentioned->meta)->toMatchArray(['bot_id' => $w['kira']->id, 'source' => 'description'])
        ->and($mentioned->meta)->not->toHaveKey('comment_id')
        ->and(WorkItemSubscriber::query()->where('user_id', $w['kira']->id)->exists())->toBeFalse()
        ->and(eventsOf(EventType::WorkItemCreated, $item)->sole()->meta['mentioned'])->toBe([$w['kira']->id]);

    app(RoleAssignments::class)->setProjectRole($default, $w['web'], ProjectRole::Member);
    $update($w['mara'], $item, ['description' => '@kira und @'.$default->handle]);

    expect(eventsOf(EventType::BotMentioned, $item)->map(fn ($event) => $event->meta['bot_id'])->all())->toBe([$w['kira']->id, $default->id]);
});

it('counts mentions in rich text values', function () use ($world, $notes, $create, $update) {
    $w = $world();
    $notes();
    $item = $create($w['mara'], $w['web'], ['description' => 'Für @lene', 'values' => ['notes' => 'Auch für @lene und @kira']]);

    $update($w['lene'], $item, ['values' => ['notes' => 'Für @lene, @kira und @mara']]);
    $events = eventsOf(EventType::WorkItemUpdated, $item)->all();

    // Lene is in the description already: the value names her not anew (A244)
    expect(eventsOf(EventType::WorkItemCreated, $item)->sole()->meta['mentioned'])->toBe([$w['lene']->id, $w['kira']->id])
        ->and(eventsOf(EventType::BotMentioned, $item)->sole()->meta)->toMatchArray(['bot_id' => $w['kira']->id, 'source' => 'values'])
        ->and($events[0]->meta['mentioned'])->toBe([$w['mara']->id]);
});

it('counts the mentions of the values a new type brings', function () use ($world, $notes, $create) {
    $w = $world();
    $property = $notes();
    $bug = WorkItemType::query()->where('name', 'Bug')->firstOrFail();
    $bug->typeProperties()->create(['property_id' => $property->id, 'required' => false, 'position' => 9]);
    $item = $create($w['mara'], $w['web'], ['values' => ['notes' => 'Für @lene']]);
    $upload = Attachment::factory()->create(['project_id' => $w['web']->id, 'uploaded_by' => $w['mara']->id]);

    ChangeWorkItemType::run(actor($w['mara']), $item, ['type_id' => $bug->id, 'values' => ['notes' => "Für @lene und @kira\n\n![](attachment:{$upload->id})"]]);

    expect(eventsOf(EventType::WorkItemUpdated, $item)->sole()->meta['mentioned'])->toBe([$w['kira']->id])
        ->and(eventsOf(EventType::BotMentioned, $item)->sole()->meta['source'])->toBe('values')
        ->and($upload->fresh()?->attachable_id)->toBe($item->id);
});
