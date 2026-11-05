<?php

use App\Actions\Automations\RunDailyAutomations;
use App\Domain\Automations\AutomationKey;
use App\Domain\Workflow\StateCategory;
use App\Domain\Workflow\StateIcon;
use App\Events\EventType;
use App\Models\Automation;
use App\Models\Comment;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkflowTransition;
use App\Models\WorkItem;
use App\Support\Actor;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Exceptions;

/*
 * Auto-Close (spec 4.13, A344, K11, K18): every night at 03:00 in the zone of the organisation the default bot moves
 * the items in Backlog or Unstarted whose last activity (their `updated_at` or their last comment) is at least `days`
 * days ago (90 to start with) into the chosen Canceled state, then comments why in the language of the organisation. A
 * move the workflow does not allow skips the item, without a comment.
 */

beforeEach(function () {
    Organization::current()->update(['timezone' => 'Europe/Berlin', 'locale' => 'de']);
    // 03:00 in Berlin (winter)
    $this->travelTo(CarbonImmutable::parse('2026-11-10 02:00:00', 'UTC'));
});

$run = fn (): array => RunDailyAutomations::run(Actor::system(User::defaultBot(), 'daily_automations'), CarbonImmutable::parse('2026-11-10 02:00:00', 'UTC'));

$state = fn (Project $project, string $name): string => (string) $project->workflow()->firstOrFail()->states()->where('name', $name)->value('id');

/**
 * A project with Auto-Close switched on (to its state `Cancelled`, or the one named), and Eltern schließen when asked.
 *
 * @param  array<string, mixed>  $settings
 */
$projectWith = function (array $settings = [], ?Workflow $workflow = null, bool $closeParent = false) use ($state): Project {
    $project = Project::factory()->create($workflow === null ? [] : ['workflow_id' => $workflow->id]);
    Automation::factory()->for($project)->key(AutomationKey::AutoClose)->enabled(['state_id' => $state($project, $workflow === null ? 'Cancelled' : 'Dropped'), ...$settings])->create();
    if ($closeParent) {
        Automation::factory()->for($project)->key(AutomationKey::CloseParent)->enabled()->create();
    }

    return $project;
};

$untouched = fn (Project $project, int $days, string $state = 'Backlog'): WorkItem => WorkItem::factory()->for($project)->inState($state)
    ->create(['created_at' => now()->subDays($days + 10), 'updated_at' => now()->subDays($days)]);

it('cancels a backlog item untouched for 90 days and comments why', function () use ($run, $projectWith, $untouched, $state) {
    $app = $projectWith();
    $backlog = $untouched($app, 90);
    $todo = $untouched($app, 120, 'Todo');
    $young = $untouched($app, 89);

    expect($run())->toBe(['archived' => 0, 'closed' => 2, 'skipped' => 0]);

    $comment = Comment::query()->where('work_item_id', $backlog->id)->sole();
    $events = eventsOf(EventType::WorkItemStateChanged, $backlog)->concat(eventsOf(EventType::CommentCreated, $backlog))->sortBy([['occurred_at', 'asc'], ['id', 'asc']])->values();

    expect($backlog->fresh()->state_id)->toBe($state($app, 'Cancelled'))
        ->and($backlog->fresh()->closed_at)->not->toBeNull()
        ->and($todo->fresh()->state_id)->toBe($state($app, 'Cancelled'))
        ->and($young->fresh()->state_id)->toBe($state($app, 'Backlog'))
        ->and($comment->author_id)->toBe(User::defaultBot()->id)
        ->and($comment->body_text)->toBe('Automatisch geschlossen: seit 90 Tagen keine Aktivität.')
        ->and($events->map(fn ($e) => $e->type->value)->all())->toBe(['work_item.state_changed', 'comment.created'])
        ->and($events->map(fn ($e) => $e->meta['reason'])->all())->toBe(['auto_close', 'auto_close'])
        ->and($events->map(fn ($e) => $e->meta['via'])->unique()->all())->toBe([Actor::VIA_AUTOMATION])
        ->and($events->map(fn ($e) => $e->actor_id)->unique()->all())->toBe([User::defaultBot()->id]);
});

it('writes the comment for one day in the singular, in the language of the organisation', function () use ($run, $projectWith, $untouched) {
    Organization::current()->update(['locale' => 'en']);
    $app = $projectWith(['days' => 1]);
    $item = $untouched($app, 1);

    $run();

    expect(Comment::query()->where('work_item_id', $item->id)->sole()->body_text)->toBe('Closed automatically: no activity for 1 day.');
});

it('cancels a backlog item without any comment (K11)', function () use ($run, $projectWith, $untouched, $state) {
    $app = $projectWith();
    $item = $untouched($app, 200);

    $run();

    expect($item->fresh()->state_id)->toBe($state($app, 'Cancelled'));
});

it('counts a comment as activity', function () use ($run, $projectWith, $untouched, $state) {
    $app = $projectWith();
    $talked = $untouched($app, 120);
    Comment::factory()->for($talked, 'workItem')->create(['created_at' => now()->subDays(89)]);
    $quiet = $untouched($app, 120);
    Comment::factory()->for($quiet, 'workItem')->create(['created_at' => now()->subDays(90)]);

    expect($run()['closed'])->toBe(1)
        ->and($talked->fresh()->state_id)->toBe($state($app, 'Backlog'))
        ->and($quiet->fresh()->state_id)->toBe($state($app, 'Cancelled'));
});

it('skips an item the workflow does not let move, without comment', function () use ($run, $projectWith, $untouched, $state) {
    // Backlog → Doing → Done, and only Doing → Dropped
    $workflow = Workflow::factory()->matrix([[0, 1], [1, 2]])->create();
    $dropped = $workflow->states()->create(['name' => 'Dropped', 'icon' => StateIcon::Cross, 'category' => StateCategory::Canceled, 'position' => 3]);
    WorkflowTransition::query()->create(['workflow_id' => $workflow->id, 'from_state_id' => $workflow->states()->where('name', 'Doing')->value('id'), 'to_state_id' => $dropped->id]);
    $project = $projectWith(workflow: $workflow);
    $item = $untouched($project, 100);
    $before = $item->fresh()->updated_at?->toIso8601String();

    expect($run())->toBe(['archived' => 0, 'closed' => 0, 'skipped' => 1])
        ->and($item->fresh()->state_id)->toBe($state($project, 'Backlog'))
        ->and($item->fresh()->updated_at?->toIso8601String())->toBe($before)
        ->and(Comment::query()->count())->toBe(0)
        ->and(eventsOf(EventType::WorkItemStateChanged)->count())->toBe(0);
});

it('leaves started items alone', function () use ($run, $projectWith, $untouched, $state) {
    $app = $projectWith();
    $started = $untouched($app, 300, 'In Progress');

    expect($run())->toBe(['archived' => 0, 'closed' => 0, 'skipped' => 0])
        ->and($started->fresh()->state_id)->toBe($state($app, 'In Progress'));
});

it('leaves archived items in an open state alone (K11)', function () use ($run, $projectWith, $state) {
    $app = $projectWith();
    $item = WorkItem::factory()->for($app)->inState('Backlog')->create(['updated_at' => now()->subDays(300), 'archived_at' => now()->subDays(300)]);

    expect($run())->toBe(['archived' => 0, 'closed' => 0, 'skipped' => 0])
        ->and($item->fresh()->state_id)->toBe($state($app, 'Backlog'));
});

it('closing the last open child closes the epic when close_parent is on', function () use ($run, $projectWith, $state) {
    $app = $projectWith(closeParent: true);
    $epic = WorkItem::factory()->for($app)->epic()->inState('In Progress')->create();
    WorkItem::factory()->childOf($epic)->closed()->create();
    $child = WorkItem::factory()->childOf($epic)->inState('Backlog')->create(['updated_at' => now()->subDays(95)]);

    expect($run())->toBe(['archived' => 0, 'closed' => 1, 'skipped' => 0])
        ->and($child->fresh()->state_id)->toBe($state($app, 'Cancelled'))
        ->and($epic->fresh()->state_id)->toBe($state($app, 'Done'))
        ->and(eventsOf(EventType::WorkItemStateChanged, $epic)->sole()->meta)->toMatchArray(['via' => Actor::VIA_AUTOMATION, 'reason' => 'close_parent']);
});

it('passes over a project whose state is no canceled state of its workflow and reports it (K11)', function () use ($run, $projectWith, $untouched, $state) {
    Exceptions::fake();
    $app = $projectWith();
    $other = $projectWith();
    // a Completed state where a Canceled one belongs (a workflow changed while the automation was saved)
    Automation::query()->where('project_id', $app->id)->where('key', AutomationKey::AutoClose)->firstOrFail()
        ->update(['settings' => ['days' => 90, 'state_id' => $state($app, 'Done')]]);
    $stays = $untouched($app, 100);
    $goes = $untouched($other, 100);

    expect($run())->toBe(['archived' => 0, 'closed' => 1, 'skipped' => 0])
        ->and($stays->fresh()->state_id)->toBe($state($app, 'Backlog'))
        ->and($goes->fresh()->state_id)->toBe($state($other, 'Cancelled'));
    Exceptions::assertReported(fn (RuntimeException $e) => str_contains($e->getMessage(), $app->identifier));
});
