<?php

use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Actions\Templates\RunTemplate;
use App\Actions\WorkItems\BulkUpdateWorkItems;
use App\Actions\WorkItems\CreateWorkItem;
use App\Actions\WorkItems\UpdateWorkItem;
use App\Events\EventType;
use App\Models\Project;
use App\Models\Template;
use App\Models\User;
use App\Models\WorkItem;
use Illuminate\Support\Facades\Storage;

/*
 * `bot.assigned` (task 10, A371, K9): recorded once a bot becomes the assignee of an item, after the event of the
 * change itself, whatever way it gets there (patch, create, bulk, template); never for a person, never for a bot that
 * assigns itself, never when the same bot stays. Subject the item, `meta.bot_id` the bot.
 */

beforeEach(fn () => Storage::fake('local'));

/** WEB with Mara as admin and lead, the bots Kira and Otto as members and Ida as a member. */
$world = function (): array {
    $mara = User::factory()->admin()->create(['name' => 'Mara', 'handle' => 'mara']);
    $web = Project::factory()->identifier('WEB')->public()->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $kira = User::factory()->bot($mara)->create(['name' => 'Kira', 'handle' => 'kira']);
    $otto = User::factory()->bot($mara)->create(['name' => 'Otto', 'handle' => 'otto']);
    app(RoleAssignments::class)->setProjectRole($kira, $web, ProjectRole::Member);
    app(RoleAssignments::class)->setProjectRole($otto, $web, ProjectRole::Member);
    $ida = memberOf($web, ProjectRole::Member, ['name' => 'Ida', 'handle' => 'ida']);

    return compact('mara', 'web', 'kira', 'otto', 'ida');
};

$create = fn (User $user, Project $project, array $input = []): WorkItem => CreateWorkItem::run(actor($user), ['project_id' => $project->id, 'title' => 'Formular prüfen', ...$input]);

it('records bot.assigned when a bot becomes the assignee with a patch', function () use ($world, $create) {
    $w = $world();
    $item = $create($w['mara'], $w['web']);

    UpdateWorkItem::run(actor($w['mara']), $item, ['assignee_id' => $w['kira']->id]);

    $event = eventsOf(EventType::BotAssigned, $item)->sole();
    expect($event->meta['bot_id'])->toBe($w['kira']->id)
        ->and($event->project_id)->toBe($w['web']->id)
        ->and($event->actor_id)->toBe($w['mara']->id)
        ->and($event->changes)->toBeNull();
    // after the event of the change itself
    $assigned = eventsOf(EventType::WorkItemAssigned, $item)->sole();
    expect($assigned->id < $event->id)->toBeTrue();
});

it('records bot.assigned when an item is created for a bot', function () use ($world, $create) {
    $w = $world();

    $item = $create($w['mara'], $w['web'], ['assignee_id' => $w['kira']->id]);

    expect(eventsOf(EventType::BotAssigned, $item)->sole()->meta['bot_id'])->toBe($w['kira']->id);
});

it('records bot.assigned for each item of a bulk change', function () use ($world, $create) {
    $w = $world();
    $one = $create($w['mara'], $w['web']);
    $two = $create($w['mara'], $w['web']);

    BulkUpdateWorkItems::run(actor($w['mara']), ['ids' => [$one->id, $two->id], 'patch' => ['assignee_id' => $w['otto']->id]]);

    expect(eventsOf(EventType::BotAssigned, $one)->sole()->meta['bot_id'])->toBe($w['otto']->id)
        ->and(eventsOf(EventType::BotAssigned, $two)->sole()->meta['bot_id'])->toBe($w['otto']->id);
});

it('records bot.assigned for a scheduled template (K9)', function () use ($world) {
    $w = $world();
    $template = Template::factory()->create(['project_id' => $w['web']->id, 'created_by' => $w['mara']->id]);
    $template->update(['payload' => [...$template->payload, 'assignee_id' => $w['kira']->id]]);

    ['item' => $item] = RunTemplate::run(actor($w['mara']), $template);

    expect(eventsOf(EventType::BotAssigned, $item)->sole()->meta['bot_id'])->toBe($w['kira']->id);
});

it('records nothing for a person', function () use ($world, $create) {
    $w = $world();
    $item = $create($w['mara'], $w['web'], ['assignee_id' => $w['ida']->id]);

    UpdateWorkItem::run(actor($w['mara']), $item, ['assignee_id' => $w['mara']->id]);

    expect(eventsOf(EventType::BotAssigned))->toHaveCount(0);
});

it('records nothing when the bot assigns itself (A371)', function () use ($world, $create) {
    $w = $world();
    $item = $create($w['mara'], $w['web']);

    UpdateWorkItem::run(actor($w['kira']), $item, ['assignee_id' => $w['kira']->id]);
    $own = $create($w['kira'], $w['web'], ['assignee_id' => $w['kira']->id]);

    expect(eventsOf(EventType::BotAssigned))->toHaveCount(0)
        ->and($own->assignee_id)->toBe($w['kira']->id);
});

it('records nothing when the same bot stays, and again when another one follows', function () use ($world, $create) {
    $w = $world();
    $item = $create($w['mara'], $w['web'], ['assignee_id' => $w['kira']->id]);

    UpdateWorkItem::run(actor($w['mara']), $item, ['assignee_id' => $w['kira']->id, 'title' => 'Anderer Titel']);
    expect(eventsOf(EventType::BotAssigned, $item))->toHaveCount(1);

    UpdateWorkItem::run(actor($w['mara']), $item->fresh(), ['assignee_id' => $w['otto']->id]);
    expect(eventsOf(EventType::BotAssigned, $item))->toHaveCount(2);
});
