<?php

use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Actions\Agents\FollowEvent;
use App\Actions\Agents\StartComment;
use App\Actions\Comments\AddComment;
use App\Actions\Comments\EditComment;
use App\Agents\AgentConsumer;
use App\Enums\Locale;
use App\Events\EventType;
use App\Models\AgentRun;
use App\Models\Comment;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkItem;
use App\Support\Actor;
use App\Support\AgentFlow;
use Tests\Support\AgentWorld;
use Tests\TestCase;

/*
 * WEBU-36: an answer to a mention needs no step of the workflow (A710), and a mention werkbuch refuses gets one note
 * of the default bot at the item that says why and who changes it (A711).
 */

beforeEach(function () {
    consumers(AgentConsumer::class);
    $this->project = Project::factory()->create(['identifier' => 'WEBU', 'name' => 'werkbuch']);
    // the workflow names no step of the agents (the default after the migration)
    Workflow::default()->forceFill(['agent_states' => null])->save();
    $this->item = WorkItem::factory()->for($this->project)->create();
    $this->mara = User::factory()->admin()->create(['name' => 'Mara']);
    [$this->runner, $this->token] = AgentWorld::runner();
});

/** The notes of the default bot at an item. */
$notes = fn (WorkItem $item) => Comment::query()->where('work_item_id', $item->id)->where('author_id', User::defaultBot()->id)->orderBy('id')->get();

/** Mara asks a bot in a new comment. */
$ask = fn (TestCase $test, User $bot, string $more = '') => AddComment::run(actor($test->mara), $test->item, ['body' => "@{$bot->handle} where is the footer built?{$more}"]);

it('answers a mention in a project whose workflow has no step of the agents', function () use ($ask, $notes) {
    $kira = AgentWorld::agent([$this->project]);
    expect(AgentFlow::refusal($kira, $this->project))->toBe('no_steps')
        ->and(AgentFlow::refusal($kira, $this->project, steps: false))->toBeNull();

    $ask($this, $kira);

    $run = $this->postJson('/api/runner/claim', [], AgentWorld::headers($this->token))->assertOk()->json('run');
    expect($run['type'])->toBe('comment')->and($run['prompt'])->toContain('where is the footer built?');
    $this->postJson("/api/runner/runs/{$run['id']}/result", ['attempt' => $run['attempt'], 'status' => 'succeeded', 'text' => 'In the shell.'], AgentWorld::headers($this->token))->assertOk();

    expect(Comment::query()->where('author_id', $kira->id)->sole()->body_text)->toBe('In the shell.')
        ->and($this->item->fresh()->state_id)->toBe(Workflow::default()->initial_state_id)
        ->and($notes($this->item))->toHaveCount(0);
});

it('says once at the item why an agent that is switched off does not answer', function () use ($ask, $notes) {
    $bob = AgentWorld::agent([$this->project], ['enabled' => false], 'Bob');

    $question = $ask($this, $bob);

    $note = $notes($this->item)->sole();
    expect(AgentRun::query()->count())->toBe(0)
        ->and($question->fresh()->refusal_noted_at)->not->toBeNull()
        ->and($question->fresh()->updated_at->eq($question->updated_at))->toBeTrue()
        ->and($note->body_text)->toBe('Bob does not answer this mention. Bob is not switched on as an agent. An org admin can change that: Set up Bob as an agent')
        ->and($note->body['content'][0]['content'][1]['marks'][0]['attrs']['href'])->toBe(config('app.url')."/settings/bots?agent={$bob->id}");

    // the note is a comment of the default bot as the agent: it mentions nobody and sets off nothing
    $event = eventsOf(EventType::CommentCreated)->last();
    expect($event->actor_id)->toBe(User::defaultBot()->id)->and($event->meta['reason'])->toBe(Actor::AGENT)
        ->and(eventsOf(EventType::BotMentioned))->toHaveCount(1);

    // the same mention a second time (a delivery again): still one note
    $mentioned = eventsOf(EventType::BotMentioned)->sole();
    expect(FollowEvent::run(Actor::system(User::defaultBot(), 'agents'), $mentioned))->toBe('ignored')
        ->and($notes($this->item))->toHaveCount(1)
        ->and(StartComment::run(Actor::system(User::defaultBot(), 'agents'), $this->item, $bob, $question))->toBeNull()
        ->and($notes($this->item))->toHaveCount(1);

    // an edit of the question explains nothing again, a new question does
    EditComment::run(actor($this->mara), $question, ['body' => "@{$bob->handle} where is the footer built, please?"]);
    expect($notes($this->item))->toHaveCount(1);
    $ask($this, $bob, ' And the header?');
    expect($notes($this->item))->toHaveCount(2);
});

it('writes in the language of the organization', function () use ($ask, $notes) {
    Organization::current()->update(['locale' => Locale::De]);
    $bob = AgentWorld::agent([$this->project], ['enabled' => false], 'Bob');

    $ask($this, $bob);

    expect($notes($this->item)->sole()->body_text)->toBe('Bob beantwortet diese Erwähnung nicht. Bob ist nicht als Agent eingeschaltet. Ein Org-Admin kann das ändern: Bob als Agent einrichten');
});

it('names every agent of the comment that does not answer in one note and lets the others work', function () use ($ask, $notes) {
    $bob = AgentWorld::agent([$this->project], ['enabled' => false], 'Bob');
    $kira = AgentWorld::agent([$this->project]);
    // a bot never set up as an agent of the runner (it may wake by a webhook, A364) and the default bot get no line
    $otto = User::factory()->bot()->create(['name' => 'Otto']);
    app(RoleAssignments::class)->setProjectRole($otto, $this->project, ProjectRole::Member);
    $viewer = AgentWorld::agent([], [], 'Vera');
    app(RoleAssignments::class)->setProjectRole($viewer, $this->project, ProjectRole::Viewer);
    app(RoleAssignments::class)->setProjectRole(User::defaultBot(), $this->project, ProjectRole::Member);

    $ask($this, $bob, " @{$kira->handle} @{$otto->handle} @{$viewer->handle} @".User::defaultBot()->handle);

    $note = $notes($this->item)->sole();
    $paragraphs = collect($note->body['content'])->map(fn (array $paragraph) => collect($paragraph['content'])->pluck('text')->implode(''));
    expect(AgentRun::query()->sole()->bot_id)->toBe($kira->id)
        ->and($paragraphs->all())->toBe([
            'Bob does not answer this mention. Bob is not switched on as an agent. An org admin can change that: Set up Bob as an agent',
            'Vera does not answer this mention. Vera may not change items of WEBU: it is no member who may edit. A project admin can change that: Members of WEBU',
        ])
        ->and($note->body['content'][1]['content'][1]['marks'][0]['attrs']['href'])->toBe(config('app.url').'/projects/WEBU/settings/members');
});

it('says nothing about a bot that was never set up as an agent, the default bot included', function () use ($ask, $notes) {
    // like Kira of the demo: a bot whose webhook hears bot.mentioned, without an agent config
    $hook = User::factory()->bot()->create(['name' => 'Hook']);
    app(RoleAssignments::class)->setProjectRole($hook, $this->project, ProjectRole::Member);
    app(RoleAssignments::class)->setProjectRole(User::defaultBot(), $this->project, ProjectRole::Member);

    $ask($this, $hook);
    $ask($this, User::defaultBot());
    $ask($this, $hook, ' @'.User::defaultBot()->handle);

    expect($notes($this->item))->toHaveCount(0)
        ->and(AgentRun::query()->count())->toBe(0)
        ->and(eventsOf(EventType::BotMentioned))->toHaveCount(4);
});

it('names the way for a bot without a responsible person and a deactivated bot', function () use ($notes) {
    $nobody = AgentWorld::agent([$this->project], [], 'Nora');
    $nobody->forceFill(['owner_id' => null])->save();
    $gone = AgentWorld::agent([$this->project], [], 'Gus');
    $comment = Comment::factory()->for($this->item, 'workItem')->create(['author_id' => $this->mara->id]);
    $gone->forceFill(['disabled_at' => now()])->save();

    StartComment::run(Actor::system(User::defaultBot(), 'agents'), $this->item, $gone, $comment);
    StartComment::run(Actor::system(User::defaultBot(), 'agents'), $this->item, $nobody, Comment::factory()->for($this->item, 'workItem')->create(['author_id' => $this->mara->id]));

    [$disabled, $owner] = $notes($this->item)->all();
    expect($disabled->body_text)->toBe('Gus does not answer this mention. Gus is deactivated. An org admin can change that: Reactivate it under Bots')
        ->and($disabled->body['content'][0]['content'][1]['marks'][0]['attrs']['href'])->toBe(config('app.url').'/settings/bots')
        ->and($owner->body_text)->toStartWith('Nora does not answer this mention. Nora has no responsible person')
        ->and($owner->body['content'][0]['content'][1]['marks'][0]['attrs']['href'])->toBe(config('app.url')."/settings/bots?agent={$nobody->id}");
});

it('explains nothing to a reader, a bot, a gone comment or item and an archived or deleted project', function () use ($notes) {
    $bob = AgentWorld::agent([$this->project], ['enabled' => false], 'Bob');
    $reader = memberOf($this->project, ProjectRole::Viewer, ['name' => 'Rita']);
    $other = AgentWorld::agent([$this->project], [], 'Otto');

    // a reader of the project and a bot mention the agent: nothing
    AddComment::run(actor($reader), $this->item, ['body' => "@{$bob->handle} hello?"]);
    AddComment::run(actor($other), $this->item, ['body' => "@{$bob->handle} hello?"]);
    expect($notes($this->item))->toHaveCount(0);

    $system = Actor::system(User::defaultBot(), 'agents');
    $comment = fn () => Comment::factory()->for($this->item, 'workItem')->create(['author_id' => $this->mara->id]);

    // the comment went before the event came
    $gone = $comment();
    $gone->delete();
    expect(StartComment::run($system, $this->item, $bob, $gone))->toBeNull();

    // the item went before the event came: the lock finds it no more
    $doomed = WorkItem::factory()->for($this->project)->create()->load('project');
    $question = Comment::factory()->for($doomed, 'workItem')->create(['author_id' => $this->mara->id]);
    WorkItem::query()->whereKey($doomed->id)->delete();
    expect(StartComment::run($system, $doomed, $bob, $question))->toBeNull()
        ->and(Comment::query()->where('author_id', User::defaultBot()->id)->count())->toBe(0);

    // an archived item, an archived project, a project being deleted
    $this->item->forceFill(['archived_at' => now()])->save();
    StartComment::run($system, $this->item, $bob, $comment());
    $this->item->forceFill(['archived_at' => null])->save();
    $this->project->forceFill(['archived_at' => now()])->save();
    StartComment::run($system, $this->item->fresh(), $bob, $comment());
    $this->project->forceFill(['archived_at' => null, 'deleting_at' => now()])->save();
    StartComment::run($system, $this->item->fresh(), $bob, $comment());

    expect($notes($this->item))->toHaveCount(0);
});
