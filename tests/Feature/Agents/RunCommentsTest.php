<?php

use App\Access\ProjectRole;
use App\Actions\Agents\HandleRunResult;
use App\Actions\Comments\AddComment;
use App\Domain\Agents\RunStatus;
use App\Domain\Agents\RunType;
use App\Events\EventType;
use App\Models\AgentRun;
use App\Models\AgentThread;
use App\Models\Comment;
use App\Models\Project;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkItem;
use App\Support\Actor;
use Tests\Support\AgentWorld;

/*
 * A comment of a bot that answers a run names the run (spec 10.6, WEBU-28, A643): `comments.run_id`, `meta.run_id` of
 * `comment.created` and `run_id` of the comment over REST; a comment of a person, and one whose run is gone, names none.
 */

beforeEach(function () {
    $this->mara = User::factory()->create(['name' => 'Mara']);
    $this->project = Project::factory()->identifier('WEB')->member($this->mara, ProjectRole::Member)->create();
    $workflow = Workflow::default();
    $states = $workflow->states->pluck('id', 'name');
    $workflow->forceFill(['agent_states' => [
        'working' => $states['In Progress'], 'review' => $states['Pending'], 'correction' => $states['Todo'], 'merged' => $states['Done'],
    ]])->save();
    $this->kira = AgentWorld::agent([$this->project]);
    $this->system = Actor::system(User::defaultBot(), 'test');
    $this->item = WorkItem::factory()->for($this->project)->create(['assignee_id' => $this->kira->id]);
});

/** A run of Kira at the item that ended. */
$ended = fn (RunType $type, RunStatus $status, array $attributes = []) => AgentWorld::run(test()->kira, test()->item, $type, [
    'status' => $status, 'finished_at' => now(), ...$attributes,
]);

it('names the run whose answer a comment of the bot is', function () use ($ended) {
    $run = $ended(RunType::Comment, RunStatus::Succeeded, ['result' => ['text' => 'The form is in `Contact.vue`.']]);

    expect(HandleRunResult::run($this->system, $run))->toBe('answered');

    $comment = Comment::query()->sole();
    expect($comment->run_id)->toBe($run->id)
        ->and(eventsOf(EventType::CommentCreated, $this->item)->sole()->meta['run_id'])->toBe($run->id);
});

it('names the run that failed, and the run whose summary ends an item without a repo', function () use ($ended) {
    $failed = $ended(RunType::Task, RunStatus::TimedOut);
    expect(HandleRunResult::run($this->system, $failed))->toBe('failed')
        ->and(Comment::query()->latest('id')->firstOrFail()->run_id)->toBe($failed->id);

    $thread = AgentThread::factory()->create(['bot_id' => $this->kira->id, 'project_id' => $this->project->id, 'work_item_id' => $this->item->id]);
    $done = $ended(RunType::Task, RunStatus::Succeeded, ['thread_id' => $thread->id, 'result' => ['summary' => 'Wrote the letter.']]);
    expect(HandleRunResult::run($this->system, $done))->toBe('done')
        ->and(Comment::query()->latest('id')->firstOrFail()->only(['body_text', 'run_id']))->toBe(['body_text' => 'Wrote the letter.', 'run_id' => $done->id]);
});

it('answers the run of a comment over REST, null for a person and once the run is gone', function () use ($ended) {
    $run = $ended(RunType::Comment, RunStatus::Succeeded, ['result' => ['text' => 'Done.']]);
    HandleRunResult::run($this->system, $run);
    $person = AddComment::run(actor($this->mara), $this->item, ['body' => 'Thanks.']);

    expect(eventsOf(EventType::CommentCreated, $this->item)->last()->meta)->not->toHaveKey('run_id');

    $this->actingAs($this->mara)->getJson("/api/v1/work-items/{$this->item->key}/comments")->assertOk()
        ->assertJsonPath('data.0.run_id', $run->id)
        ->assertJsonPath('data.1.id', $person->id)
        ->assertJsonPath('data.1.run_id', null);

    AgentRun::query()->whereKey($run->id)->delete();
    expect(Comment::query()->where('author_id', $this->kira->id)->sole()->run_id)->toBeNull();
});
