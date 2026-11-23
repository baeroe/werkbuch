<?php

use App\Domain\Agents\RunStatus;
use App\Domain\Agents\RunType;
use App\Events\EventType;
use App\Models\AgentRun;
use App\Models\GitHubInstallation;
use App\Models\GitHubRepository;
use App\Models\PersonalAccessToken;
use App\Models\Project;
use App\Models\ProjectRepository;
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
    $this->github->refuse = ['/app/installations/*/access_tokens' => 500];

    expect($claim($token)->assertOk()->json('run'))->toBeNull();
    $run->refresh();
    expect([$run->status, $run->attempt, $run->error, $run->runner_id])->toBe([RunStatus::Queued, 2, 'git_token', null])
        ->and(eventsOf(EventType::AgentRunQueued)->last()->meta)->toMatchArray(['reason' => 'git_token', 'attempt' => 2])
        ->and(PersonalAccessToken::query()->where('agent_run_id', $run->id)->exists())->toBeFalse();

    expect($claim($token)->assertOk()->json('run'))->toBeNull();
    $run->refresh();
    expect([$run->status, $run->error])->toBe([RunStatus::Failed, 'git_token']);
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
