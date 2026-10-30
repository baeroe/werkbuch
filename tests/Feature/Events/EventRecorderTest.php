<?php

use App\Events\EventRecorder;
use App\Events\EventType;
use App\Jobs\DispatchEvent;
use App\Models\Event;
use App\Models\Project;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;

beforeEach(fn () => Queue::fake());

it('records who did what to which subject, when and how', function () {
    $this->travelTo(Carbon::parse('2026-10-31 09:15:30.123456'));
    $project = Project::factory()->create();
    $actor = new Actor($project->lead, Actor::VIA_AUTOMATION, 'Automatisierung: Auto-Archiv');
    $changes = ['name' => ['old' => 'Website', 'new' => 'Website-Relaunch']];

    $recorded = DB::transaction(fn () => EventRecorder::record(EventType::ProjectUpdated, $actor, $project, $project, $changes, ['identifier' => 'WEB']));
    $event = Event::query()->findOrFail($recorded->id);

    expect($event->type)->toBe(EventType::ProjectUpdated)
        ->and($event->actor_id)->toBe($project->lead_id)
        ->and($event->actor?->is($project->lead))->toBeTrue()
        ->and($event->subject_type)->toBe('project')
        ->and($event->subject_id)->toBe($project->id)
        ->and($event->subject?->is($project))->toBeTrue()
        ->and($event->project_id)->toBe($project->id)
        ->and($event->changes)->toBe($changes)
        ->and($event->meta)->toBe(['via' => 'automation', 'reason' => 'Automatisierung: Auto-Archiv', 'identifier' => 'WEB'])
        ->and($event->occurred_at->format('Y-m-d H:i:s.u'))->toBe('2026-10-31 09:15:30.123456')
        ->and($event->dispatched_at)->toBeNull();
    Queue::assertPushed(DispatchEvent::class, fn (DispatchEvent $job) => $job->eventId === $event->id && $job->afterCommit === true);
});

it('records an event without project and without changes', function () {
    $user = User::factory()->create();

    $event = DB::transaction(fn () => EventRecorder::record('user.updated', actor($user), $user, null));

    expect($event->fresh()?->type)->toBe(EventType::UserUpdated)
        ->and($event->fresh()?->subject_type)->toBe('user')
        ->and($event->fresh()?->project_id)->toBeNull()
        ->and($event->fresh()?->changes)->toBeNull()
        ->and($event->fresh()?->meta)->toBe(['via' => 'ui', 'reason' => null]);
});

it('keeps via and reason of the actor', function () {
    $user = User::factory()->create();

    $event = DB::transaction(fn () => EventRecorder::record(EventType::UserUpdated, actor($user), $user, null, null, ['via' => 'mcp', 'reason' => 'x']));

    expect($event->meta)->toBe(['via' => 'ui', 'reason' => null]);
});

it('notes the token an account acted with', function () {
    $user = User::factory()->create();
    $token = $user->createToken('ci')->accessToken;

    $event = DB::transaction(fn () => EventRecorder::record(EventType::TokenCreated, new Actor($user, Actor::VIA_API, token: $token), $token, null));

    expect($event->fresh()?->meta)->toBe(['via' => 'api', 'reason' => null, 'token_id' => $token->id])
        ->and($event->fresh()?->subject_type)->toBe('token');
});

it('refuses an unknown type', function () {
    $user = User::factory()->create();

    DB::transaction(fn () => EventRecorder::record('user.renamed', actor($user), $user, null));
})->throws(ValueError::class);
