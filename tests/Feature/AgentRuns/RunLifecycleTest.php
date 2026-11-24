<?php

use App\Actions\AgentRuns\CancelRun;
use App\Actions\AgentRuns\PruneRunEvents;
use App\Actions\AgentRuns\ReapLostRuns;
use App\Actions\Projects\PurgeProject as PurgeProjectAction;
use App\Actions\Runners\RevokeRunner;
use App\Domain\Agents\Protocol;
use App\Domain\Agents\RunStatus;
use App\Domain\Agents\RunType;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Jobs\PruneRunEventsJob;
use App\Jobs\PurgeProject;
use App\Jobs\ReapLostRunsJob;
use App\Models\AgentRun;
use App\Models\AgentRunEvent;
use App\Models\AgentThread;
use App\Models\PersonalAccessToken;
use App\Models\Project;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Queue\Middleware\WithoutOverlapping;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Queue;
use Tests\Support\AgentWorld;

/*
 * The life of a run after the claim (spec 6.4, 7.5, 11.2): heartbeat, log, result, cancel, the reaper with lease, loss
 * and time limit, and the token of the run, which ends with it.
 */

beforeEach(function () {
    $this->project = Project::factory()->create();
    $this->agent = AgentWorld::agent([$this->project]);
    [$this->runner, $this->token] = AgentWorld::runner();
});

$system = fn () => Actor::system(User::defaultBot(), 'test');

/** Queues a run of the kind and lets the runner of the test claim it; the run and its token. */
$claimed = function (RunType $type = RunType::Task): array {
    $run = AgentWorld::run(test()->agent, test()->project, $type);
    $answer = test()->postJson('/api/runner/claim', [], AgentWorld::headers(test()->token))->assertOk()->json('run');
    expect($answer['id'])->toBe($run->id);

    return [$run->fresh(), $answer['werkbuch']['token']];
};

$beat = fn (AgentRun $run, int $attempt = 1, array $body = []) => test()->postJson("/api/runner/runs/{$run->id}/heartbeat", ['attempt' => $attempt, ...$body], AgentWorld::headers(test()->token));
$finish = fn (AgentRun $run, array $body, int $attempt = 1) => test()->postJson("/api/runner/runs/{$run->id}/result", ['attempt' => $attempt, ...$body], AgentWorld::headers(test()->token));
$log = fn (AgentRun $run, array $events, int $attempt = 1) => test()->postJson("/api/runner/runs/{$run->id}/events", ['attempt' => $attempt, 'events' => $events], AgentWorld::headers(test()->token));

it('extends the lease with every heartbeat and tells the runner of a cancel', function () use ($claimed, $beat) {
    [$run] = $claimed();
    $this->travel(40)->seconds();

    $beat($run)->assertOk()->assertJsonPath('cancel', false)
        ->assertJsonPath('lease_expires_at', now()->addSeconds(Protocol::LEASE_SECONDS)->startOfSecond()->toJSON())
        ->assertJsonPath('deadline_at', $run->deadline()?->toJSON());

    $person = User::factory()->admin()->create();
    expect(CancelRun::run(actor($person), $run)->status)->toBe(RunStatus::Canceling)
        ->and(CancelRun::run(actor($person), $run)->status)->toBe(RunStatus::Canceling)
        ->and(eventsOf(EventType::AgentRunCanceled, $run)->count())->toBe(1);
    $beat($run)->assertOk()->assertJsonPath('cancel', true);
});

it('stores the result as the runner reports it and ends the run', function () use ($claimed, $finish) {
    $thread = AgentThread::factory()->create(['bot_id' => $this->agent->id, 'project_id' => $this->project->id]);
    $run = AgentWorld::run($this->agent, $this->project, RunType::Correction, ['thread_id' => $thread->id]);
    $this->postJson('/api/runner/claim', [], AgentWorld::headers($this->token))->assertJsonPath('run.id', $run->id);

    $finish($run, [
        'status' => 'succeeded', 'session_id' => 'sess-42', 'verdict' => 'approve', 'commit' => 'abc1234def',
        'summary' => 'Fixed the login.', 'usage' => ['input' => 1200, 'output' => 300],
    ])->assertOk()->assertExactJson(['run' => ['id' => $run->id, 'status' => 'succeeded']]);

    $run->refresh();
    expect($run->result)->toBe(['commit' => 'abc1234def', 'summary' => 'Fixed the login.'])
        ->and([$run->session_id, $run->usage, $run->lease_expires_at, $run->finished_at?->isToday()])->toBe(['sess-42', ['input' => 1200, 'output' => 300], null, true])
        ->and($thread->fresh()->session_id)->toBe('sess-42')
        ->and(eventsOf(EventType::AgentRunFinished, $run)->sole()->changes)->toBe(['status' => ['old' => null, 'new' => 'succeeded']]);

    // a review keeps its verdict and findings
    [$review] = $claimed(RunType::Review);
    $finish($review, ['status' => 'succeeded', 'verdict' => 'changes', 'text' => "- **Important** `a.php:3`\n"])->assertOk();
    expect($review->fresh()->result)->toBe(['verdict' => 'changes', 'text' => '- **Important** `a.php:3`']);

    [$failing] = $claimed();
    $finish($failing, ['status' => 'done', 'verdict' => 'maybe', 'commit' => 'xyz', 'usage' => ['input' => -1], 'text' => 3])->assertUnprocessable()
        ->assertJsonValidationErrors(['status', 'verdict', 'commit', 'usage.input', 'usage.output', 'text']);
    $finish($failing, ['status' => 'failed', 'error' => 'claude: model not found'])->assertOk();
    expect([$failing->fresh()->status, $failing->fresh()->error])->toBe([RunStatus::Failed, 'claude: model not found']);
});

it('refuses a heartbeat or result of a replaced attempt', function () use ($claimed, $beat, $finish, $log, $system) {
    [$run] = $claimed();
    [, $other] = AgentWorld::runner();

    $beat($run, 2)->assertConflict()->assertJsonPath('reason', 'run_replaced');
    $this->postJson("/api/runner/runs/{$run->id}/heartbeat", ['attempt' => 1], AgentWorld::headers($other))->assertConflict();
    $beat($run, 0)->assertUnprocessable()->assertJsonValidationErrors(['attempt']);
    $this->postJson('/api/runner/runs/nope/heartbeat', ['attempt' => 1], AgentWorld::headers($this->token))->assertNotFound();
    $this->postJson('/api/runner/runs/01J00000000000000000000000/heartbeat', ['attempt' => 1], AgentWorld::headers($this->token))->assertNotFound();

    // the lease runs out: werkbuch queues the run as attempt 2, the old attempt may no longer write
    $this->travel(2)->minutes();
    expect(ReapLostRuns::run($system())['requeued'])->toBe(1);
    $beat($run)->assertConflict();
    $finish($run, ['status' => 'succeeded'])->assertConflict();
    $log($run, [['kind' => 'text', 'text' => 'late']])->assertConflict();

    $again = $this->postJson('/api/runner/claim', [], AgentWorld::headers($this->token))->json('run');
    expect([$again['id'], $again['attempt']])->toBe([$run->id, 2]);
    $finish($run, ['status' => 'succeeded'])->assertConflict();
    $finish($run, ['status' => 'succeeded'], 2)->assertOk();
    $beat($run, 2)->assertConflict();
});

it('marks a run lost after its lease and queues it once more, then fails it', function () use ($claimed, $system) {
    [$run, $token] = $claimed();

    $this->travel(Protocol::LEASE_SECONDS - 1)->seconds();
    expect(ReapLostRuns::run($system())['requeued'])->toBe(0);

    $this->travel(2)->seconds();
    expect(ReapLostRuns::run($system()))->toMatchArray(['requeued' => 1, 'lost' => 0]);
    $run->refresh();
    expect([$run->status, $run->attempt, $run->runner_id, $run->error])->toBe([RunStatus::Queued, 2, null, AgentRun::LOST])
        ->and(PersonalAccessToken::findToken($token))->toBeNull()
        ->and(eventsOf(EventType::AgentRunQueued, $run)->last()->meta)->toMatchArray(['reason' => 'lost', 'attempt' => 2]);

    $this->postJson('/api/runner/claim', [], AgentWorld::headers($this->token))->assertJsonPath('run.attempt', 2);
    $this->travel(2)->minutes();
    expect(ReapLostRuns::run($system()))->toMatchArray(['requeued' => 0, 'lost' => 1])
        ->and($run->fresh()->status)->toBe(RunStatus::Lost)
        ->and(PersonalAccessToken::query()->where('agent_run_id', $run->id)->exists())->toBeFalse()
        ->and(eventsOf(EventType::AgentRunFinished, $run)->sole()->changes['status']['new'])->toBe('lost');
});

it('times a run out after the fixed limit of its type (60/30/20/10 minutes)', function (RunType $type, int $minutes) use ($claimed, $beat, $system) {
    [$run] = $claimed($type);

    // heartbeats keep the lease, the limit holds anyway: past it and one more lease, werkbuch ends the run
    foreach (range(1, $minutes) as $minute) {
        $this->travel(1)->minutes();
        $beat($run)->assertOk();
    }
    expect(ReapLostRuns::run($system())['timed_out'])->toBe(0);

    $this->travel(Protocol::LEASE_SECONDS + 1)->seconds();
    $beat($run)->assertOk();
    expect(ReapLostRuns::run($system())['timed_out'])->toBe(1)
        ->and([$run->fresh()->status, $run->fresh()->error])->toBe([RunStatus::TimedOut, 'timed_out']);
    $beat($run)->assertConflict();
})->with([[RunType::Task, 120], [RunType::Correction, 120], [RunType::Conflict, 30], [RunType::Review, 20], [RunType::Comment, 10]]);

it('ends a run being canceled whose runner went quiet', function () use ($claimed, $system) {
    [$run] = $claimed();
    CancelRun::run(actor(User::factory()->admin()->create()), $run);

    $this->travel(2)->minutes();
    expect(ReapLostRuns::run($system())['canceled'])->toBe(1)
        ->and($run->fresh()->status)->toBe(RunStatus::Canceled);
});

it('revokes the run token when the run ends in any status', function (string $how) use ($claimed, $finish, $system) {
    [$run, $token] = $claimed();
    $admin = User::factory()->admin()->create();
    expect(PersonalAccessToken::findToken($token))->not->toBeNull();

    match ($how) {
        'succeeded', 'failed', 'canceled', 'timed_out' => $finish($run, ['status' => $how])->assertOk(),
        'revoked' => RevokeRunner::run(actor($admin), $this->runner),
        'reaped' => (function () use ($system) {
            $this->travel(3)->hours();
            ReapLostRuns::run($system());
        })(),
    };

    expect($run->fresh()->status->finished())->toBeTrue()
        ->and(PersonalAccessToken::findToken($token))->toBeNull();
    forgetApiAuth();
    $this->withToken($token)->getJson('/api/v1/me')->assertUnauthorized();
})->with(['succeeded', 'failed', 'canceled', 'timed_out', 'revoked', 'reaped']);

it('cancels a waiting run at once and refuses to cancel one that ended', function () use ($system) {
    $run = AgentWorld::run($this->agent, $this->project);
    $admin = User::factory()->admin()->create();

    $canceled = CancelRun::run(actor($admin), $run);
    expect([$canceled->status, $canceled->canceled_by, $canceled->finished_at !== null])->toBe([RunStatus::Canceled, $admin->id, true])
        ->and(fn () => CancelRun::run(actor($admin), $run))->toThrow(Problem::class);
    expect(ReapLostRuns::run($system())['waiting'])->toBe(0);
});

it('keeps the log of a run with its kinds, blanks tokens and stores it in order', function () use ($claimed, $log) {
    [$run, $token] = $claimed();

    $log($run, [
        ['kind' => 'system', 'text' => 'claude 2.4.1, model sonnet'],
        ['kind' => 'tool', 'text' => "Bash: curl -H 'Authorization: Bearer {$token}' and wbr_".str_repeat('a', 40).' ghs_'.str_repeat('B', 36).' '.explode('|', $token)[1], 'at' => now()->subSecond()->toJSON()],
        ['kind' => 'text', 'text' => str_repeat('x', 5000), 'at' => now()->addDay()->toJSON()],
    ])->assertOk()->assertExactJson(['stored' => 3, 'dropped' => 0]);

    $lines = AgentRunEvent::query()->where('run_id', $run->id)->orderBy('id')->get();
    expect($lines->pluck('kind')->all())->toBe(['system', 'tool', 'text'])
        ->and($lines[1]->text)->toBe("Bash: curl -H 'Authorization: Bearer [token]' and [token] [token] [token]")
        ->and(mb_strlen($lines[2]->text))->toBe(Protocol::EVENT_TEXT_MAX)
        ->and($lines[2]->at->isFuture())->toBeFalse();

    $log($run, [])->assertUnprocessable()->assertJsonValidationErrors(['events']);
    $log($run, [['kind' => 'shout', 'text' => 'x']])->assertUnprocessable()->assertJsonValidationErrors(['events.0.kind']);

    $admin = User::factory()->admin()->create();
    $this->actingAs($admin)->getJson("/api/v1/runs/{$run->id}/events")->assertOk()->assertJsonPath('meta.total', 3)->assertJsonPath('data.0.kind', 'system');
});

it('prunes run events after 30 days and keeps at most 2000 events or 1 MB per run', function () use ($claimed, $log, $system) {
    [$run] = $claimed();
    $line = fn (int $bytes) => ['kind' => 'text', 'text' => str_repeat('y', $bytes)];

    foreach (range(1, 20) as $batch) {
        $log($run, array_fill(0, 100, $line(10)))->assertOk()->assertJsonPath('dropped', 0);
        $this->travel(1)->seconds();
        $this->postJson("/api/runner/runs/{$run->id}/heartbeat", ['attempt' => 1], AgentWorld::headers($this->token));
    }
    $log($run, array_fill(0, 5, $line(10)))->assertOk()->assertJsonPath('dropped', 5);
    expect(AgentRunEvent::query()->where('run_id', $run->id)->count())->toBe(Protocol::EVENTS_MAX_ROWS);

    // 1 MB: big lines push the oldest out
    $log($run, array_fill(0, 100, $line(4000)))->assertOk();
    $log($run, array_fill(0, 100, $line(4000)))->assertOk();
    $log($run, array_fill(0, 100, $line(4000)))->assertOk()->assertJsonPath('dropped', fn (int $dropped) => $dropped > 0);
    expect((int) AgentRunEvent::query()->where('run_id', $run->id)->sum('bytes'))->toBeLessThanOrEqual(Protocol::EVENTS_MAX_BYTES)
        ->and($run->fresh()->events_dropped)->toBeGreaterThan(5);

    $old = AgentRunEvent::query()->count();
    $this->travel(31)->days();
    $kept = AgentWorld::run($this->agent, $this->project);
    AgentRunEvent::query()->create(['run_id' => $kept->id, 'attempt' => 1, 'kind' => 'text', 'text' => 'new', 'bytes' => 3, 'at' => now()]);
    expect(PruneRunEvents::run($system()))->toBe($old)
        ->and(AgentRunEvent::query()->pluck('run_id')->all())->toBe([$kept->id]);
});

it('never writes a runner, run or installation token into events, jobs or the log', function () use ($claimed, $finish, $log) {
    $logged = [];
    Event::listen(MessageLogged::class, function (MessageLogged $message) use (&$logged) {
        $logged[] = $message->message.json_encode($message->context);
    });
    [$run, $token] = $claimed();
    $log($run, [['kind' => 'text', 'text' => "token {$token} and {$this->token}"]])->assertOk();
    $finish($run, ['status' => 'failed', 'error' => "leaked {$token}", 'summary' => $this->token])->assertOk();

    $secrets = [$token, $this->token, explode('|', $token)[1]];
    $tables = ['events', 'jobs', 'failed_jobs', 'agent_run_events', 'agent_runs', 'runners'];
    foreach ($tables as $table) {
        $rows = json_encode(DB::table($table)->get());
        foreach ($secrets as $secret) {
            expect(str_contains((string) $rows, $secret))->toBeFalse("a token in {$table}");
        }
    }
    foreach ($secrets as $secret) {
        expect(str_contains(implode("\n", $logged), $secret))->toBeFalse('a token in the log');
    }
});

it('reaps every minute and prunes every hour as jobs that never run twice at once', function () use ($claimed) {
    [$run] = $claimed();
    $tasks = collect(app(Schedule::class)->events());
    $reaper = $tasks->sole(fn ($event) => $event->description === ReapLostRunsJob::class);
    $pruner = $tasks->sole(fn ($event) => $event->description === PruneRunEventsJob::class);
    AgentRunEvent::query()->create(['run_id' => $run->id, 'attempt' => 1, 'kind' => 'text', 'text' => 'old', 'bytes' => 3, 'at' => now()->subDays(40)]);
    $this->travel(2)->minutes();

    (new ReapLostRunsJob)->handle();
    (new PruneRunEventsJob)->handle();

    expect([$reaper->expression, $pruner->expression])->toBe(['* * * * *', '0 * * * *'])
        ->and([$reaper->withoutOverlapping, $pruner->withoutOverlapping])->toBe([true, true])
        ->and(collect((new ReapLostRunsJob)->middleware())->sole())->toBeInstanceOf(WithoutOverlapping::class)
        ->and(collect((new PruneRunEventsJob)->middleware())->sole())->toBeInstanceOf(WithoutOverlapping::class)
        ->and($run->fresh()->status)->toBe(RunStatus::Queued)
        ->and(AgentRunEvent::query()->count())->toBe(0);
});

it('ends the runs of a project being deleted and takes their tokens with them (A489)', function () use ($claimed) {
    [$run, $token] = $claimed();
    $waiting = AgentWorld::run(test()->agent, test()->project);
    $admin = User::factory()->admin()->create();
    Queue::fake([PurgeProject::class]);

    $this->actingAs($admin)->deleteJson('/api/v1/projects/'.test()->project->id)->assertStatus(202);
    expect([$run->fresh()?->status, $run->fresh()?->error, $waiting->fresh()?->status])->toBe([RunStatus::Canceled, 'project_deleted', RunStatus::Canceled])
        ->and(PersonalAccessToken::query()->where('agent_run_id', $run->id)->exists())->toBeFalse();
    forgetApiAuth();
    $this->withToken($token)->getJson('/api/v1/me')->assertUnauthorized();
    forgetApiAuth();
    $this->postJson("/api/runner/runs/{$run->id}/heartbeat", ['attempt' => 1], AgentWorld::headers(test()->token))->assertConflict();
});

it('takes the token of a run with the run when a project is purged (A489)', function () {
    $run = AgentWorld::run(test()->agent, test()->project);
    AgentWorld::token($run);
    test()->project->update(['deleting_at' => now()]);

    PurgeProjectAction::run(actor(User::defaultBot()), test()->project);

    expect(AgentRun::query()->find($run->id))->toBeNull()
        ->and(PersonalAccessToken::query()->where('agent_run_id', $run->id)->exists())->toBeFalse()
        ->and(PersonalAccessToken::query()->where('tokenable_id', test()->agent->id)->exists())->toBeFalse();
});
