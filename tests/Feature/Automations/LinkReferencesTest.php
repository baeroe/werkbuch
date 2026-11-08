<?php

use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Actions\Comments\AddComment;
use App\Actions\Comments\EditComment;
use App\Actions\Pages\CreatePage;
use App\Actions\Templates\RunDueTemplates;
use App\Actions\Templates\RunTemplate;
use App\Actions\WorkItems\ChangeWorkItemType;
use App\Actions\WorkItems\CreateWorkItem;
use App\Actions\WorkItems\UpdateWorkItem;
use App\Domain\Automations\AutomationKey;
use App\Domain\Properties\FieldType;
use App\Events\EventType;
use App\Jobs\LinkReferencesJob;
use App\Models\Automation;
use App\Models\Event;
use App\Models\Notification;
use App\Models\Project;
use App\Models\Property;
use App\Models\RelationType;
use App\Models\Template;
use App\Models\User;
use App\Models\WorkItem;
use App\Models\WorkItemRelation;
use App\Models\WorkItemSubscriber;
use App\Models\WorkItemType;
use App\Notifications\NotificationConsumer;
use App\Support\Actor;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Tests\Support\Mcp\McpClient;
use Tests\Support\RichTextFixtures as F;

/*
 * The automation `link_references` (A452, A453), on by default: a text of an item that names another item anew (a
 * reference of kind `item` in the description, a rich text value or a comment) relates both with the built-in type
 * `relates`, after the commit of the change, as the default bot on behalf of the person who wrote.
 */

beforeEach(function () {
    Storage::fake('local');
});

/** WEB with Mara as its admin and Lene as a member, two items A and B; OPS (private) with Mara as a member and item C. */
$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara', 'handle' => 'mara']);
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $lene = memberOf($web, ProjectRole::Member, ['name' => 'Lene', 'handle' => 'lene']);
    $ops = Project::factory()->identifier('OPS')->private()->member($mara, ProjectRole::Member)->create(['lead_id' => $mara->id]);
    $a = WorkItem::factory()->for($web)->create(['created_by' => $mara->id]);
    $b = WorkItem::factory()->for($web)->create(['created_by' => $mara->id]);
    $c = WorkItem::factory()->for($ops)->create(['created_by' => $mara->id]);

    return compact('mara', 'lene', 'web', 'ops', 'a', 'b', 'c');
};

/** A description naming the items. */
$naming = fn (WorkItem ...$items): array => F::doc(F::p('Siehe ', ...array_map(fn (WorkItem $item) => F::reference($item->id), $items)));

$describe = fn (User $user, WorkItem $item, WorkItem ...$named): WorkItem => UpdateWorkItem::run(actor($user), $item, ['description_json' => $naming(...$named)]);

/** The relations as `[type, source, target]`, by source and target. */
$relations = fn (): array => WorkItemRelation::query()->orderBy('source_id')->orderBy('target_id')->get()
    ->map(fn (WorkItemRelation $relation) => [$relation->type_id, $relation->source_id, $relation->target_id])->all();

$relates = fn (): string => (string) RelationType::query()->where('built_in', 'relates')->value('id');

/** A rich text property `notes` on the type. */
$notes = function (string $type = 'Task'): Property {
    $property = Property::query()->firstWhere('key', 'notes') ?? Property::factory()->create(['key' => 'notes', 'label' => 'Notizen', 'field_type' => FieldType::RichText]);
    $on = WorkItemType::query()->where('name', $type)->firstOrFail();
    $on->typeProperties()->create(['property_id' => $property->id, 'required' => false, 'position' => $on->typeProperties()->count()]);

    return $property;
};

it('relates an item to an item its description names anew', function () use ($world, $describe, $relations, $relates) {
    $w = $world();

    $describe($w['mara'], $w['a'], $w['b']);
    $events = Event::query()->where('type', EventType::WorkItemRelationAdded)->orderBy('subject_id')->get();

    expect($relations())->toBe([[$relates(), $w['a']->id, $w['b']->id]])
        ->and($events->pluck('subject_id')->sort()->values()->all())->toBe(collect([$w['a']->id, $w['b']->id])->sort()->values()->all())
        ->and($events->pluck('actor_id')->unique()->all())->toBe([User::defaultBot()->id]);
    foreach ($events as $event) {
        expect($event->meta)->toMatchArray(['via' => Actor::VIA_AUTOMATION, 'reason' => 'link_references', 'on_behalf_of' => $w['mara']->id]);
    }
});

it('relates for a new item, a rich text value, a change of type, a new comment and an edited comment', function (string $case) use ($world, $naming, $notes, $relations, $relates) {
    $w = $world();
    $mara = actor($w['mara']);

    $source = match ($case) {
        'create' => CreateWorkItem::run($mara, ['project_id' => $w['web']->id, 'title' => 'Neu', 'description_json' => $naming($w['b'])]),
        'value' => (function () use ($w, $mara, $naming, $notes) {
            $notes();

            return UpdateWorkItem::run($mara, $w['a'], ['values' => ['notes' => $naming($w['b'])]]);
        })(),
        'type change' => (function () use ($w, $mara, $naming, $notes) {
            $notes('Bug');

            return ChangeWorkItemType::run($mara, $w['a'], ['type_id' => WorkItemType::query()->where('name', 'Bug')->value('id'), 'values' => ['notes' => $naming($w['b'])]]);
        })(),
        'comment' => (function () use ($w, $mara, $naming) {
            AddComment::run($mara, $w['a'], ['body_json' => $naming($w['b'])]);

            return $w['a'];
        })(),
        'edited comment' => (function () use ($w, $mara, $naming) {
            $comment = AddComment::run($mara, $w['a'], ['body' => 'Erst ohne Verweis']);
            expect(WorkItemRelation::query()->count())->toBe(0);
            EditComment::run($mara, $comment, ['body_json' => $naming($w['b'])]);

            return $w['a'];
        })(),
    };

    expect($relations())->toBe([[$relates(), $source->id, $w['b']->id]]);
})->with(['create', 'value', 'type change', 'comment', 'edited comment']);

it('relates only references new against the text before', function () use ($world, $describe, $naming, $notes) {
    $w = $world();
    $notes();
    $describe($w['mara'], $w['a'], $w['b']);
    $comment = AddComment::run(actor($w['mara']), $w['a'], ['body_json' => $naming($w['c'])]);
    Queue::fake([LinkReferencesJob::class]);

    // the same reference with other words, a value naming what the description names, the comment with its reference kept
    UpdateWorkItem::run(actor($w['mara']), $w['a'], ['description_json' => F::doc(F::p('Weiterhin ', F::reference($w['b']->id), ' offen')), 'values' => ['notes' => $naming($w['b'])]]);
    EditComment::run(actor($w['mara']), $comment, ['body_json' => F::doc(F::p('Noch ', F::reference($w['c']->id)))]);

    Queue::assertNothingPushed();
    expect(WorkItemRelation::query()->count())->toBe(2);

    // a reference the item did not name before
    $other = WorkItem::factory()->for($w['web'])->create();
    $describe($w['mara'], $w['a'], $w['b'], $other);

    Queue::assertPushed(LinkReferencesJob::class, fn (LinkReferencesJob $job) => $job->itemId === $w['a']->id && $job->targetIds === [$other->id]);
});

it('makes no second relation when one exists in either direction', function () use ($world, $describe, $relations, $relates) {
    $w = $world();
    WorkItemRelation::factory()->create(['type_id' => $relates(), 'source_id' => $w['b']->id, 'target_id' => $w['a']->id]);
    $other = WorkItem::factory()->for($w['web'])->create();

    $describe($w['mara'], $w['a'], $w['b'], $other);

    $expected = [[$relates(), $w['a']->id, $other->id], [$relates(), $w['b']->id, $w['a']->id]];
    usort($expected, fn ($x, $y) => [$x[1], $x[2]] <=> [$y[1], $y[2]]);
    expect($relations())->toBe($expected)
        ->and(eventsOf(EventType::WorkItemRelationAdded, $w['b']))->toHaveCount(0)
        ->and(eventsOf(EventType::WorkItemRelationAdded, $other))->toHaveCount(1);
});

it('never relates an item to itself', function () use ($world, $describe, $relations, $relates) {
    $w = $world();
    Queue::fake([LinkReferencesJob::class]);

    $describe($w['mara'], $w['a'], $w['a'], $w['b']);

    Queue::assertPushed(LinkReferencesJob::class, fn (LinkReferencesJob $job) => $job->targetIds === [$w['b']->id]);
    Queue::pushed(LinkReferencesJob::class)->sole()->handle();

    expect($relations())->toBe([[$relates(), $w['a']->id, $w['b']->id]]);
});

it('relates across projects the writer sees', function () use ($world, $describe, $relations, $relates) {
    $w = $world();

    $describe($w['mara'], $w['a'], $w['c']);

    expect($relations())->toBe([[$relates(), $w['a']->id, $w['c']->id]])
        ->and(eventsOf(EventType::WorkItemRelationAdded, $w['c'])->sole()->project_id)->toBe($w['ops']->id);
});

it('takes an archived target as passive end', function () use ($world, $describe, $relations, $relates) {
    $w = $world();
    $archived = WorkItem::factory()->for($w['web'])->archived()->create(['updated_at' => now()->subDay()]);

    $describe($w['mara'], $w['a'], $archived);

    expect($relations())->toBe([[$relates(), $w['a']->id, $archived->id]])
        ->and(eventsOf(EventType::WorkItemRelationAdded, $archived))->toHaveCount(1)
        ->and($archived->fresh()?->updated_at?->isToday())->toBeTrue()
        ->and($archived->fresh()?->archived_at)->not->toBeNull();
});

it('relates nothing when the source or its project is archived or the source is gone by the time the job runs', function (string $case) use ($world, $describe) {
    $w = $world();
    Queue::fake([LinkReferencesJob::class]);
    $describe($w['mara'], $w['a'], $w['b']);
    $job = Queue::pushed(LinkReferencesJob::class)->sole();

    match ($case) {
        'source archived' => WorkItem::query()->whereKey($w['a']->id)->update(['archived_at' => now()]),
        'project archived' => $w['web']->update(['archived_at' => now()]),
        'source gone' => WorkItem::query()->whereKey($w['a']->id)->delete(),
    };
    $job->handle();

    expect(WorkItemRelation::query()->count())->toBe(0);

    if ($case !== 'source gone') {
        // the same job, the source writable again: it relates
        WorkItem::query()->whereKey($w['a']->id)->update(['archived_at' => null]);
        $w['web']->update(['archived_at' => null]);
        $job->handle();

        expect(WorkItemRelation::query()->count())->toBe(1);
    }
})->with(['source archived', 'project archived', 'source gone']);

it('keeps the relation when the reference goes', function () use ($world, $describe, $relations, $relates) {
    $w = $world();
    $describe($w['mara'], $w['a'], $w['b']);

    UpdateWorkItem::run(actor($w['mara']), $w['a'], ['description' => 'Kein Verweis mehr']);

    expect($relations())->toBe([[$relates(), $w['a']->id, $w['b']->id]])
        ->and($w['a']->fresh()?->description_text)->toBe('Kein Verweis mehr')
        ->and(eventsOf(EventType::WorkItemRelationRemoved, $w['a']))->toHaveCount(0)
        ->and(eventsOf(EventType::WorkItemRelationAdded, $w['a']))->toHaveCount(1);
});

it('relates nothing when the automation is off', function () use ($world, $describe) {
    $w = $world();
    $automation = Automation::factory()->for($w['web'])->key(AutomationKey::LinkReferences)->create(['enabled' => false]);
    Queue::fake([LinkReferencesJob::class]);

    $describe($w['mara'], $w['a'], $w['b']);
    Queue::assertNothingPushed();

    // switched on, the next new reference queues a job; switched off before it runs, it relates nothing
    $automation->update(['enabled' => true]);
    $describe($w['mara'], $w['a'], $w['c']);
    $job = Queue::pushed(LinkReferencesJob::class)->sole();
    $automation->update(['enabled' => false]);
    $job->handle();

    expect(WorkItemRelation::query()->count())->toBe(0);
});

it('relates nothing for a wiki page', function () use ($world, $naming, $describe, $relations, $relates) {
    $w = $world();

    CreatePage::run(actor($w['mara']), $w['web'], ['title' => 'Plan', 'content_json' => $naming($w['b'])]);
    expect(WorkItemRelation::query()->count())->toBe(0);

    $describe($w['mara'], $w['a'], $w['b']);
    expect($relations())->toBe([[$relates(), $w['a']->id, $w['b']->id]]);
});

it('acts for the person a bot wrote for in a template run by hand', function () use ($world, $naming, $relations, $relates) {
    $w = $world();
    $template = Template::factory()->create(['project_id' => $w['web']->id, 'created_by' => $w['mara']->id]);
    $template->update(['payload' => [...$template->payload, 'description' => $naming($w['b'])]]);

    $item = RunTemplate::run(actor($w['mara']), $template)['item'];
    assert($item instanceof WorkItem);

    expect($relations())->toBe([[$relates(), $item->id, $w['b']->id]])
        ->and(eventsOf(EventType::WorkItemRelationAdded, $w['b'])->sole()->meta)
        ->toMatchArray(['via' => Actor::VIA_AUTOMATION, 'reason' => 'link_references', 'on_behalf_of' => $w['mara']->id]);
});

it('acts without on_behalf_of for a scheduled run', function () use ($world, $naming, $relations, $relates) {
    $w = $world();
    $this->travelTo('2026-11-01 12:00:00');
    $template = Template::factory()->scheduled(['frequency' => 'daily', 'interval' => 1, 'time' => '09:00', 'starts_on' => '2026-10-26', 'ends' => ['type' => 'never']])
        ->create(['project_id' => $w['web']->id, 'created_by' => $w['mara']->id]);
    $template->update(['payload' => [...$template->payload, 'description' => $naming($w['b'])]]);
    $this->travelTo('2026-11-02 09:00:30');

    expect(RunDueTemplates::run(Actor::system(User::defaultBot(), 'templates'), true))->toBe(1);
    $item = WorkItem::query()->where('template_id', $template->id)->sole();
    $meta = eventsOf(EventType::WorkItemRelationAdded, $w['b'])->sole()->meta;

    expect($relations())->toBe([[$relates(), $item->id, $w['b']->id]])
        ->and($meta)->toMatchArray(['via' => Actor::VIA_AUTOMATION, 'reason' => 'link_references'])
        ->and($meta)->not->toHaveKey('on_behalf_of');
});

it('passes over a target the writer no longer sees when the job runs', function () use ($world, $describe, $relations, $relates) {
    $w = $world();
    Queue::fake([LinkReferencesJob::class]);
    $describe($w['mara'], $w['a'], $w['c'], $w['b']);
    $job = Queue::pushed(LinkReferencesJob::class)->sole();

    app(RoleAssignments::class)->removeFromProject($w['mara'], $w['ops']);
    $job->handle();

    expect($job->targetIds)->toBe([$w['c']->id, $w['b']->id])
        ->and($relations())->toBe([[$relates(), $w['a']->id, $w['b']->id]]);
});

it('queues no job when the save rolls back', function () use ($world, $describe) {
    $w = $world();
    config(['queue.default' => 'database']);
    $queued = fn (): int => DB::table('jobs')->where('payload', 'like', '%LinkReferencesJob%')->count();

    try {
        DB::transaction(function () use ($w, $describe) {
            $describe($w['mara'], $w['a'], $w['b']);

            throw new RuntimeException('after the save');
        });
    } catch (RuntimeException) {
    }
    expect($queued())->toBe(0)
        ->and($w['a']->fresh()?->description)->toBeNull();

    $describe($w['mara'], $w['a'], $w['b']);
    expect($queued())->toBe(1);
});

it('tells watchers of the target but not the writer', function () use ($world, $describe) {
    $w = $world();
    consumers(NotificationConsumer::class);
    foreach ([[$w['b'], $w['lene']], [$w['b'], $w['mara']], [$w['a'], $w['mara']]] as [$item, $user]) {
        WorkItemSubscriber::query()->create(['work_item_id' => $item->id, 'user_id' => $user->id, 'reason' => 'manual']);
    }

    $describe($w['mara'], $w['a'], $w['b']);
    $lene = Notification::query()->where('user_id', $w['lene']->id)->sole();

    expect($lene->work_item_id)->toBe($w['b']->id)
        ->and($lene->kind->value)->toBe('item_changed')
        ->and($lene->data)->toBe(['fields' => ['relation']])
        ->and($lene->actor_id)->toBe(User::defaultBot()->id)
        ->and(Notification::query()->where('user_id', $w['mara']->id)->count())->toBe(0);
});

it('relates for a change over REST and over MCP', function (string $via) use ($world, $relations, $relates) {
    $w = $world();

    if ($via === 'rest') {
        $this->withToken(apiToken($w['mara'], ['write']))->patchJson('/api/v1/work-items/WEB-1', ['description' => 'Siehe WEB-2'])->assertOk();
    } else {
        $mcp = McpClient::for($this, apiToken($w['mara'], ['read', 'write', 'mcp']));
        $answer = $mcp->call('manage-work-items', ['action' => 'update', 'item' => 'WEB-1', 'input' => ['description' => 'Siehe WEB-2']]);
        expect($answer['isError'])->toBeFalse((string) json_encode($answer));
    }

    expect($w['a']->key)->toBe('WEB-1')
        ->and($relations())->toBe([[$relates(), $w['a']->id, $w['b']->id]])
        ->and(eventsOf(EventType::WorkItemRelationAdded, $w['b'])->sole()->meta)->toMatchArray(['on_behalf_of' => $w['mara']->id]);
})->with(['rest', 'mcp']);
