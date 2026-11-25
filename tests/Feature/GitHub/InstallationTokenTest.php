<?php

use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Actions\AgentRuns\ClaimRun;
use App\Domain\Agents\RunStatus;
use App\Domain\Agents\RunType;
use App\Events\EventType;
use App\Models\AgentRun;
use App\Models\GitHubInstallation;
use App\Models\GitHubRepository;
use App\Models\PersonalAccessToken;
use App\Models\Project;
use App\Models\ProjectRepository;
use App\Support\RunQueue;
use Illuminate\Contracts\Debug\ExceptionHandler;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Http;
use Tests\Support\AgentWorld;
use Tests\Support\FakeGitHub;

/*
 * Installation tokens (spec 6.3, 6.4, 11.3): a claim hands a run of a project with a repo the repo and a token for it
 * alone with the permissions of its kind; the runner renews it at `runs/{id}/git-token`. A token is in these answers
 * only, never in an event, a job or the log.
 */

$claim = fn (string $token) => test()->postJson('/api/runner/claim', [], AgentWorld::headers($token));

beforeEach(function () {
    $this->github = FakeGitHub::connected();
    $this->project = Project::factory()->identifier('WEB')->create();
    $this->agent = AgentWorld::agent([$this->project]);
    FakeGitHub::link($this->project);
});

it('takes the token of a repo from the app whose installation reaches it', function () use ($claim) {
    [, $token] = AgentWorld::runner();
    // a project with a repo of the app of another GitHub account (A680)
    $second = $this->github->secondApp();
    $labs = Project::factory()->identifier('LAB')->create();
    app(RoleAssignments::class)->setProjectRole($this->agent, $labs, ProjectRole::Member);
    FakeGitHub::link($labs, 'feldwerk-labs/app');

    AgentWorld::run($this->agent, $labs, RunType::Task);
    $run = $claim($token)->assertOk()->json('run');

    expect($run['git'])->toMatchArray(['repo_url' => 'https://github.com/feldwerk-labs/app.git', 'token' => $this->github->tokens[0]])
        ->and($this->github->issued)->toBe([['token' => $this->github->tokens[0], 'installation' => 55_000_002, 'app_id' => $second->app_id]]);
});

it('scopes the installation token to the one repo and the permissions of the run type', function () use ($claim) {
    [, $token] = AgentWorld::runner();
    $logged = [];
    Event::listen(MessageLogged::class, function (MessageLogged $message) use (&$logged) {
        $logged[] = $message->message.json_encode($message->context);
    });

    AgentWorld::run($this->agent, $this->project, RunType::Task);
    $task = $claim($token)->assertOk()->json('run');
    expect($task['git'])->toMatchArray(['repo_url' => 'https://github.com/feldwerk/website.git', 'token' => $this->github->tokens[0]])
        ->and($task['git']['expires_at'])->toEndWith('Z');
    Http::assertSent(fn ($request) => str_ends_with($request->url(), '/app/installations/55000001/access_tokens')
        && $request['repository_ids'] === [700_000_001]
        && $request['permissions'] === ['contents' => 'write', 'pull_requests' => 'write', 'checks' => 'read', 'actions' => 'read', 'metadata' => 'read']
        && str_starts_with($request->header('Authorization')[0], 'Bearer ey'));

    AgentWorld::run($this->agent, $this->project, RunType::Review);
    $review = $claim($token)->assertOk()->json('run');
    expect($review['type'])->toBe('review')->and($review['git']['token'])->toBe($this->github->tokens[1]);
    Http::assertSent(fn ($request) => str_ends_with($request->url(), '/access_tokens')
        && $request['permissions'] === ['contents' => 'read', 'pull_requests' => 'read', 'metadata' => 'read']);

    // never in an event, a job or the log
    $events = DB::table('events')->pluck('changes')->merge(DB::table('events')->pluck('meta'))->implode(' ');
    foreach ($this->github->tokens as $issued) {
        expect($events)->not->toContain($issued)
            ->and(DB::table('jobs')->pluck('payload')->implode(' '))->not->toContain($issued)
            ->and(implode(' ', $logged))->not->toContain($issued);
    }
});

it('hands a project without a repo no git', function () use ($claim) {
    [, $token] = AgentWorld::runner();
    $other = Project::factory()->identifier('OPS')->create();
    $run = AgentWorld::run(AgentWorld::agent([$other], [], 'Otto'), $other);

    $answer = $claim($token)->assertOk()->json('run');
    expect($answer['id'])->toBe($run->id)->and($answer['git'])->toBeNull();
    Http::assertNothingSent();
});

it('gives the run back once when GitHub refuses the token, then fails it', function () use ($claim) {
    [, $token] = AgentWorld::runner();
    $run = AgentWorld::run($this->agent, $this->project);
    $this->github->refuse = ['/app/installations/*/access_tokens' => 422];

    expect($claim($token)->assertOk()->json('run'))->toBeNull();
    $run->refresh();
    expect([$run->status, $run->attempt, $run->error, $run->runner_id])->toBe([RunStatus::Queued, 2, 'git_token', null])
        ->and(eventsOf(EventType::AgentRunQueued)->last()->meta)->toMatchArray(['reason' => 'git_token', 'attempt' => 2])
        ->and(PersonalAccessToken::query()->where('agent_run_id', $run->id)->exists())->toBeFalse();

    expect($claim($token)->assertOk()->json('run'))->toBeNull();
    $run->refresh();
    expect([$run->status, $run->error])->toBe([RunStatus::Failed, 'git_token']);
});

it('lets a run wait without counting an attempt while GitHub does not answer or answers with a 5xx', function () use ($claim) {
    [, $token] = AgentWorld::runner();
    $run = AgentWorld::run($this->agent, $this->project);
    $this->github->refuse = ['/app/installations/*/access_tokens' => 502];

    expect($claim($token)->assertOk()->json('run'))->toBeNull();
    $run->refresh();
    expect([$run->status, $run->waiting_reason, $run->attempt, $run->runner_id])->toBe([RunStatus::Waiting, 'github_unavailable', 1, null])
        ->and($run->retry_at->getTimestamp())->toBe(now()->addSeconds(ClaimRun::RETRY_SECONDS)->getTimestamp())
        // the event says what the run is now: waiting, for GitHub
        ->and([eventsOf(EventType::AgentRunQueued)->last()->changes['status']['new'], eventsOf(EventType::AgentRunQueued)->last()->meta['reason']])->toBe(['waiting', 'github_unavailable'])
        ->and(PersonalAccessToken::query()->where('agent_run_id', $run->id)->exists())->toBeFalse();
    // the reason holds while it waits
    RunQueue::refreshReasons();
    expect($run->fresh()->waiting_reason)->toBe('github_unavailable');

    // not before its time, then again; GitHub not answering at all is the same
    expect($claim($token)->assertOk()->json('run'))->toBeNull();
    $this->travel(ClaimRun::RETRY_SECONDS + 1)->seconds();
    $this->github->refuse = [];
    $this->github->meanwhile = function ($request) {
        if (str_contains($request->url(), 'access_tokens')) {
            throw new ConnectionException('timeout');
        }
    };
    expect($claim($token)->assertOk()->json('run'))->toBeNull()
        ->and([$run->fresh()->status, $run->fresh()->attempt])->toBe([RunStatus::Waiting, 1]);

    $this->travel(ClaimRun::RETRY_SECONDS + 1)->seconds();
    $this->github->meanwhile = null;
    expect($claim($token)->assertOk()->json('run.id'))->toBe($run->id)
        ->and([$run->fresh()->status, $run->fresh()->attempt])->toBe([RunStatus::Running, 1]);
});

it('gives the run back after anything else that goes wrong while werkbuch asks for its token', function () use ($claim) {
    [, $token] = AgentWorld::runner();
    $run = AgentWorld::run($this->agent, $this->project);
    $reported = 0;
    $this->app->make(ExceptionHandler::class)->reportable(function (LogicException $e) use (&$reported) {
        $reported++;

        return false;
    });
    $this->github->meanwhile = function ($request) {
        if (str_contains($request->url(), 'access_tokens')) {
            throw new LogicException('Something else');
        }
    };

    expect($claim($token)->assertOk()->json('run'))->toBeNull()
        ->and([$run->fresh()->status, $run->fresh()->attempt, $run->fresh()->error])->toBe([RunStatus::Queued, 2, 'git_token'])
        ->and($reported)->toBe(1);
});

it('hands out no run that was canceled while GitHub answered', function () use ($claim) {
    [, $token] = AgentWorld::runner();
    $run = AgentWorld::run($this->agent, $this->project);
    $this->github->meanwhile = function ($request) use ($run) {
        if (str_contains($request->url(), 'access_tokens')) {
            AgentRun::query()->whereKey($run->id)->update(['status' => RunStatus::Canceling->value]);
        }
    };

    expect($claim($token)->assertOk()->json('run'))->toBeNull()
        ->and($run->fresh()->status)->toBe(RunStatus::Canceling);
});

it('fails a run at once whose repo the app no longer reaches, on the second attempt', function () use ($claim) {
    [, $token] = AgentWorld::runner();
    $run = AgentWorld::run($this->agent, $this->project, RunType::Task, ['attempt' => 2]);
    GitHubRepository::query()->update(['removed_at' => now()]);

    expect($claim($token)->assertOk()->json('run'))->toBeNull()
        ->and($run->fresh()->status)->toBe(RunStatus::Failed);
    Http::assertNotSent(fn ($request) => str_contains($request->url(), 'access_tokens'));
});

it('renews the token of a running run for its runner in its attempt only', function () use ($claim) {
    [$runner, $token] = AgentWorld::runner();
    AgentWorld::run($this->agent, $this->project);
    $run = $claim($token)->json('run');
    $renew = fn (array $body, string $id = '') => $this->postJson('/api/runner/runs/'.($id ?: $run['id']).'/git-token', $body, AgentWorld::headers($token));

    $answer = $renew(['attempt' => 1])->assertOk()->json();
    expect($answer['git'])->toMatchArray(['repo_url' => 'https://github.com/feldwerk/website.git', 'token' => $this->github->tokens[1]])
        ->and($answer['places']['used']['total'])->toBe(1)
        ->and($answer['protocol'])->toBe(1);

    $renew(['attempt' => 2])->assertConflict()->assertJsonPath('reason', 'run_replaced');
    $renew([])->assertUnprocessable();
    $renew(['attempt' => 1], '01J00000000000000000000000')->assertNotFound();
    [, $stranger] = AgentWorld::runner();
    $this->postJson("/api/runner/runs/{$run['id']}/git-token", ['attempt' => 1], AgentWorld::headers($stranger))->assertConflict();

    $this->github->refuse = ['/app/installations/*/access_tokens' => 502];
    $renew(['attempt' => 1])->assertStatus(503)->assertJsonPath('reason', 'github_unavailable');

    GitHubInstallation::query()->update(['suspended_at' => now()]);
    $renew(['attempt' => 1])->assertConflict()->assertJsonPath('reason', 'repository_unavailable');

    GitHubInstallation::query()->update(['suspended_at' => null]);
    // no token while the guard holds the project, none for a run being canceled
    ProjectRepository::query()->update(['guard_detected_at' => now(), 'guard_sha' => str_repeat('a', 40), 'guard_branch' => 'main']);
    $renew(['attempt' => 1])->assertConflict()->assertJsonPath('reason', 'merge_guard_open');
    ProjectRepository::query()->update(ProjectRepository::GUARD);
    AgentRun::query()->whereKey($run['id'])->update(['status' => RunStatus::Canceling->value]);
    $renew(['attempt' => 1])->assertConflict()->assertJsonPath('reason', 'run_canceling');
    AgentRun::query()->whereKey($run['id'])->update(['status' => RunStatus::Running->value]);

    ProjectRepository::query()->delete();
    $renew(['attempt' => 1])->assertConflict()->assertJsonPath('reason', 'no_repository');

    expect(AgentRun::query()->find($run['id'])->status)->toBe(RunStatus::Running)->and($runner->busyRuns()->count())->toBe(1);
});

it('leaves a run alone that changed while GitHub refused its token', function () use ($claim) {
    [, $token] = AgentWorld::runner();
    $run = AgentWorld::run($this->agent, $this->project);
    $this->github->refuse = ['/app/installations/*/access_tokens' => 500];
    $this->github->meanwhile = fn () => AgentRun::query()->whereKey($run->id)->update(['status' => RunStatus::Canceling]);

    expect($claim($token)->assertOk()->json('run'))->toBeNull()
        ->and([$run->fresh()->status, $run->fresh()->attempt])->toBe([RunStatus::Canceling, 1]);
});
