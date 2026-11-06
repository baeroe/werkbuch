<?php

use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Actions\Auth\AcceptInvitation;
use App\Actions\Comments\AddComment;
use App\Actions\Comments\AddReaction;
use App\Actions\Comments\DeleteComment;
use App\Actions\Comments\EditComment;
use App\Actions\Comments\RemoveReaction;
use App\Actions\Favorites\ToggleFavorite;
use App\Actions\Invitations\InviteUser;
use App\Actions\Labels\DeleteLabel;
use App\Actions\Pages\CreatePage;
use App\Actions\Pages\DeletePage;
use App\Actions\Pages\MovePage;
use App\Actions\Pages\UpdatePage;
use App\Actions\Projects\AddMember;
use App\Actions\Projects\ArchiveProject;
use App\Actions\Projects\CreateProject;
use App\Actions\Projects\DeleteProject;
use App\Actions\Projects\UpdateProject;
use App\Actions\Tokens\CreateToken;
use App\Actions\Users\CreateBot;
use App\Actions\Users\DeactivateUser;
use App\Actions\Users\ReactivateUser;
use App\Actions\Users\UpdateUser;
use App\Actions\Workflows\SaveWorkflow;
use App\Actions\WorkItems\AddRelation;
use App\Actions\WorkItems\ArchiveWorkItem;
use App\Actions\WorkItems\CreateWorkItem;
use App\Actions\WorkItems\DeleteWorkItem;
use App\Actions\WorkItems\RestoreWorkItem;
use App\Actions\WorkItems\SetSubscription;
use App\Actions\WorkItems\TransitionWorkItem;
use App\Actions\WorkItems\UpdateWorkItem;
use App\Events\EventType;
use App\Events\Outbox;
use App\Jobs\ConsumeEvent;
use App\Models\Event;
use App\Models\Label;
use App\Models\Page;
use App\Models\Project;
use App\Models\RelationType;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkItem;
use App\Search\SearchConsumer;
use App\Search\SearchIndexer;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Tests\Support\WorkflowFixtures;

beforeEach(fn () => consumers(SearchConsumer::class));

/** WEB (the default workflow) with Mara as its admin and lead, and Ole, an org admin. */
$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara']);
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);

    return [$web, $mara, User::factory()->admin()->create(['name' => 'Ole'])];
};

/** A new item of the project, created by Mara through the action (so its events reach the consumer). */
$create = fn (Project $project, User $mara, string $title = 'Kontaktformular') => CreateWorkItem::run(actor($mara), ['project_id' => $project->id, 'title' => $title]);

/** The ids of the documents of an index. */
$ids = fn ($engine, string $index): array => array_keys($engine->documents($index));

it('indexes an item when it is created, changed, moved, assigned, archived and restored', function () use ($world, $create) {
    $engine = searchEngine();
    [$web, $mara] = $world();
    $document = fn (WorkItem $item): ?array => $engine->documents('testing_work_items')[$item->id] ?? null;
    $done = $web->workflow->states()->where('name', 'Done')->value('id');

    $item = $create($web, $mara);
    expect($document($item))->toMatchArray(['key' => 'WEB-1', 'title' => 'Kontaktformular', 'state_category' => 'backlog',
        'assignee_id' => null, 'archived' => false]);

    UpdateWorkItem::run(actor($mara), $item, ['title' => 'Kontaktformular prüfen']);
    expect($document($item))->toMatchArray(['title' => 'Kontaktformular prüfen']);

    TransitionWorkItem::run(actor($mara), $item, ['to_state_id' => $done]);
    expect($document($item))->toMatchArray(['state_category' => 'completed']);

    UpdateWorkItem::run(actor($mara), $item, ['assignee_id' => $mara->id]);
    expect($document($item))->toMatchArray(['assignee_id' => $mara->id]);

    ArchiveWorkItem::run(actor($mara), $item);
    expect($document($item))->toMatchArray(['archived' => true]);

    RestoreWorkItem::run(actor($mara), $item);
    expect($document($item))->toMatchArray(['archived' => false]);
});

it('removes a deleted item', function () use ($world, $create, $ids) {
    $engine = searchEngine();
    [$web, $mara] = $world();
    $gone = $create($web, $mara);
    $kept = $create($web, $mara, 'Impressum');

    DeleteWorkItem::run(actor($mara), $gone);

    expect($ids($engine, 'testing_work_items'))->toBe([$kept->id]);
});

it('indexes a project when it is created, archived and restored', function () use ($world) {
    $engine = searchEngine();
    [, $mara] = $world();
    $document = fn (Project $project): ?array => $engine->documents('testing_projects')[$project->id] ?? null;

    $app = CreateProject::run(actor($mara), ['name' => 'Kundenportal', 'identifier' => 'APP']);
    expect($document($app))->toMatchArray(['identifier' => 'APP', 'name' => 'Kundenportal', 'archived' => false]);

    ArchiveProject::run(actor($mara), $app);
    expect($document($app))->toMatchArray(['archived' => true]);

    ArchiveProject::run(actor($mara), $app, false);
    expect($document($app))->toMatchArray(['archived' => false]);
});

it('updates the keys of every item when the identifier of the project changes', function () use ($world, $create) {
    $engine = searchEngine();
    [$web, $mara] = $world();
    $first = $create($web, $mara);
    $second = $create($web, $mara, 'Impressum');
    $keys = fn (): array => array_map(fn (array $document) => $document['key'], $engine->documents('testing_work_items'));
    expect($keys())->toBe([$first->id => 'WEB-1', $second->id => 'WEB-2']);

    UpdateProject::run(actor($mara), $web, ['identifier' => 'WWW']);

    expect($keys())->toBe([$first->id => 'WWW-1', $second->id => 'WWW-2'])
        ->and($engine->documents('testing_projects')[$web->id])->toMatchArray(['identifier' => 'WWW', 'former_identifiers' => ['WEB']]);
});

it('removes a deleted project and its items, also after the purge ran', function () use ($world, $create, $ids) {
    $engine = searchEngine();
    [$web, $mara] = $world();
    $ops = Project::factory()->identifier('OPS')->member($mara, ProjectRole::Admin)->create();
    $create($web, $mara);
    $create($web, $mara, 'Impressum');
    $kept = $create($ops, $mara, 'Backup');
    app(SearchIndexer::class)->upsertProject($web->id);
    app(SearchIndexer::class)->upsertProject($ops->id);
    Queue::fake([ConsumeEvent::class]);

    DeleteProject::run(actor($mara), $web);

    // the purge (queue `bulk`) ran before the consumer (queue `search`): the rows are gone, the documents not yet
    expect(Project::query()->find($web->id))->toBeNull()
        ->and($ids($engine, 'testing_work_items'))->toHaveCount(3);

    Queue::pushed(ConsumeEvent::class)->sole(fn (ConsumeEvent $job) => $job->consumer === SearchConsumer::class)->handle(app(Outbox::class));

    expect($ids($engine, 'testing_work_items'))->toBe([$kept->id])
        ->and($ids($engine, 'testing_projects'))->toBe([$ops->id]);
});

it('indexes a created, saved and moved page', function () use ($world) {
    $engine = searchEngine();
    [$web, $mara] = $world();
    $document = fn (Page $page): ?array => $engine->documents('testing_pages')[$page->id] ?? null;

    $guide = CreatePage::run(actor($mara), $web, ['title' => 'Handbuch']);
    $page = CreatePage::run(actor($mara), $web, ['title' => 'Onboarding', 'content' => 'Der **erste** Tag']);
    expect($document($page))->toMatchArray(['project_id' => $web->id, 'title' => 'Onboarding', 'text' => 'Der erste Tag']);

    UpdatePage::run(actor($mara), $page, ['title' => 'Onboarding im Team', 'content' => 'Die erste Woche']);
    expect($document($page))->toMatchArray(['title' => 'Onboarding im Team', 'text' => 'Die erste Woche']);

    $writes = $engine->writes();
    MovePage::run(actor($mara), Page::query()->findOrFail($page->id), ['parent_id' => $guide->id, 'before_id' => null]);
    expect($engine->writes())->toBe($writes + 1)
        ->and(array_keys($engine->documents('testing_pages')))->toBe([$guide->id, $page->id]);
});

it('removes every page of a deleted subtree', function () use ($world) {
    $engine = searchEngine();
    [$web, $mara] = $world();
    $root = CreatePage::run(actor($mara), $web, ['title' => 'Handbuch']);
    $child = CreatePage::run(actor($mara), $web, ['title' => 'Kapitel', 'parent_id' => $root->id]);
    $grandchild = CreatePage::run(actor($mara), $web, ['title' => 'Abschnitt', 'parent_id' => $child->id]);
    $kept = CreatePage::run(actor($mara), $web, ['title' => 'Impressum']);
    expect(array_keys($engine->documents('testing_pages')))->toHaveCount(4);

    DeletePage::run(actor($mara), Page::query()->findOrFail($root->id));

    expect(eventsOf(EventType::PageDeleted)->sole()->meta['page_ids'])->toEqualCanonicalizing([$root->id, $child->id, $grandchild->id])
        ->and(array_keys($engine->documents('testing_pages')))->toBe([$kept->id]);
});

it('removes the pages of a deleted project', function () use ($world, $ids) {
    $engine = searchEngine();
    [$web, $mara] = $world();
    $ops = Project::factory()->identifier('OPS')->member($mara, ProjectRole::Admin)->create();
    CreatePage::run(actor($mara), $web, ['title' => 'Onboarding']);
    $kept = CreatePage::run(actor($mara), $ops, ['title' => 'Backup']);
    Queue::fake([ConsumeEvent::class]);

    DeleteProject::run(actor($mara), $web);

    // the purge ran first: the rows are gone, the documents go by the project's id
    expect(Page::query()->where('project_id', $web->id)->count())->toBe(0)
        ->and($ids($engine, 'testing_pages'))->toHaveCount(2);

    Queue::pushed(ConsumeEvent::class)->sole(fn (ConsumeEvent $job) => $job->consumer === SearchConsumer::class)->handle(app(Outbox::class));

    expect($ids($engine, 'testing_pages'))->toBe([$kept->id]);
});

it('takes a page.updated twice the same way', function () use ($world) {
    $engine = searchEngine();
    [$web, $mara] = $world();
    $page = CreatePage::run(actor($mara), $web, ['title' => 'Onboarding']);
    UpdatePage::run(actor($mara), $page, ['title' => 'Onboarding neu', 'content' => 'Der erste Tag']);
    $event = eventsOf(EventType::PageUpdated, $page)->sole();
    $before = $engine->documents('testing_pages');

    // a retry after a failure later in the claim transaction writes the same document again
    app(SearchConsumer::class)->consume($event);
    app(SearchConsumer::class)->consume($event);

    expect($engine->documents('testing_pages'))->toBe($before)
        ->and($before[$page->id])->toMatchArray(['title' => 'Onboarding neu', 'text' => 'Der erste Tag']);
});

it('removes a page that is gone when its event arrives', function () use ($world, $ids) {
    $engine = searchEngine();
    [$web, $mara] = $world();
    $page = CreatePage::run(actor($mara), $web, ['title' => 'Onboarding']);
    $kept = CreatePage::run(actor($mara), $web, ['title' => 'Impressum']);
    Queue::fake([ConsumeEvent::class]);
    UpdatePage::run(actor($mara), $page, ['title' => 'Onboarding neu']);
    DB::table('pages')->where('id', $page->id)->delete();

    Queue::pushed(ConsumeEvent::class)->sole(fn (ConsumeEvent $job) => $job->consumer === SearchConsumer::class)->handle(app(Outbox::class));

    expect($ids($engine, 'testing_pages'))->toBe([$kept->id]);
});

it('indexes people and bots and marks deactivated accounts', function () use ($world) {
    $engine = searchEngine();
    [, $mara, $ole] = $world();
    $document = fn (User $user): ?array => $engine->documents('testing_users')[$user->id] ?? null;

    $bot = CreateBot::run(actor($ole), ['name' => 'Kira', 'handle' => 'kira', 'owner_id' => $ole->id]);
    $invitation = InviteUser::run(actor($ole), ['email' => 'lea@example.com', 'org_role' => 'member', 'projects' => []]);
    $lea = AcceptInvitation::run($invitation, ['name' => 'Lea Sommer', 'password' => 'secret-pass']);
    UpdateUser::run(actor($ole), $mara, ['name' => 'Mara Vogt']);
    DeactivateUser::run(actor($ole), $mara);

    expect($document($bot))->toMatchArray(['name' => 'Kira', 'handle' => 'kira', 'type' => 'bot', 'disabled' => false])
        ->and($document($lea))->toMatchArray(['name' => 'Lea Sommer', 'type' => 'person', 'disabled' => false])
        ->and($document($mara))->toMatchArray(['name' => 'Mara Vogt', 'type' => 'person', 'disabled' => true]);

    ReactivateUser::run(actor($ole), $mara);

    expect($document($mara))->toMatchArray(['disabled' => false]);
});

it('indexes the default bot from the event of migration 000500', function () {
    $engine = searchEngine();
    $event = eventsOf(EventType::BotCreated)->first();

    expect(app(Outbox::class)->consume($event->id, SearchConsumer::class))->toBeTrue()
        ->and($engine->documents('testing_users')[User::defaultBot()->id] ?? null)
        ->toMatchArray(['handle' => 'automation', 'type' => 'bot', 'disabled' => false]);
});

it('reindexes the items of a workflow\'s projects after the workflow changed', function () use ($world) {
    $engine = searchEngine();
    [$web, , $ole] = $world();
    $agency = SaveWorkflow::run(actor($ole), null, WorkflowFixtures::agencyInput());
    $ops = Project::factory()->identifier('OPS')->create(['workflow_id' => $agency->id]);
    $pending = WorkItem::factory()->for($web)->inState('Pending')->create();
    $elsewhere = WorkItem::factory()->for($ops)->create();
    app(SearchIndexer::class)->upsertItem($pending->id);
    expect($engine->documents('testing_work_items')[$pending->id]['state_category'])->toBe('started');

    $input = WorkflowFixtures::inputOf(Workflow::default());
    $input['states'] = array_map(fn (array $state) => $state['name'] === 'Pending' ? [...$state, 'category' => 'unstarted'] : $state, $input['states']);
    SaveWorkflow::run(actor($ole), Workflow::default(), $input);

    // the category of a status changed without an event of the item; the items of other workflows stay as they were
    expect($engine->documents('testing_work_items')[$pending->id]['state_category'])->toBe('unstarted')
        ->and($engine->documents('testing_work_items'))->not->toHaveKey($elsewhere->id);
});

it('reindexes every item after a label was deleted', function () use ($world, $create) {
    $engine = searchEngine();
    [$web, $mara, $ole] = $world();
    $ops = Project::factory()->identifier('OPS')->member($mara, ProjectRole::Admin)->create();
    [$ux, $bug] = Label::factory()->count(2)->create();
    $inWeb = $create($web, $mara);
    $inOps = $create($ops, $mara, 'Backup');
    UpdateWorkItem::run(actor($mara), $inWeb, ['label_ids' => [$ux->id, $bug->id]]);
    UpdateWorkItem::run(actor($mara), $inOps, ['label_ids' => [$ux->id]]);

    DeleteLabel::run(actor($ole), $ux);

    expect($engine->documents('testing_work_items')[$inWeb->id]['label_ids'])->toBe([$bug->id])
        ->and($engine->documents('testing_work_items')[$inOps->id]['label_ids'])->toBe([]);
});

it('reindexes the item when a comment is added, edited or deleted', function () use ($world, $create) {
    $engine = searchEngine();
    [$web, $mara] = $world();
    $item = $create($web, $mara);
    $other = $create($web, $mara, 'Impressum');
    $comments = fn (WorkItem $of): string => $engine->documents('testing_work_items')[$of->id]['comments'];
    $writes = $engine->writes();

    $first = AddComment::run(actor($mara), $item, ['body' => 'Die **Pflichtfelder** fehlen']);
    $second = AddComment::run(actor($mara), $item, ['body' => 'Auch im Impressum']);
    expect($comments($item))->toBe("Die Pflichtfelder fehlen\nAuch im Impressum")
        ->and($engine->writes())->toBe($writes + 2);

    EditComment::run(actor($mara), $first, ['body' => 'Die Pflichtfelder fehlen weiter']);
    expect($comments($item))->toBe("Die Pflichtfelder fehlen weiter\nAuch im Impressum");

    DeleteComment::run(actor($mara), $second);
    expect($comments($item))->toBe('Die Pflichtfelder fehlen weiter')
        ->and($comments($other))->toBe('')
        ->and($engine->writes())->toBe($writes + 4);
});

it('ignores reactions and mentions of bots', function () use ($world, $create) {
    $engine = searchEngine();
    [$web, $mara] = $world();
    $kira = User::factory()->bot($mara)->create(['name' => 'Kira', 'handle' => 'kira']);
    app(RoleAssignments::class)->setProjectRole($kira, $web, ProjectRole::Member);
    $item = $create($web, $mara);
    $writes = $engine->writes();

    // the comment writes the document once (comment.created); its bot.mentioned changes nothing of it
    $comment = AddComment::run(actor($mara), $item, ['body' => '@kira bitte prüfen']);
    AddReaction::run(actor($mara), $comment, ['emoji' => '👍']);
    RemoveReaction::run(actor($mara), $comment, ['emoji' => '👍']);

    expect(eventsOf(EventType::BotMentioned, $item))->toHaveCount(1)
        ->and(eventsOf(EventType::CommentReactionAdded, $item))->toHaveCount(1)
        ->and(eventsOf(EventType::CommentReactionRemoved, $item))->toHaveCount(1)
        ->and($engine->writes())->toBe($writes + 1);
});

it('ignores events that change no document', function () use ($world) {
    $engine = searchEngine();
    [$web, $mara] = $world();
    [$item, $other] = WorkItem::factory()->for($web)->count(2)->create();

    // the events of the migrations other than the default bot: the built-in catalog
    $catalog = Event::query()->where('type', '!=', EventType::BotCreated)->pluck('id');
    $catalog->each(fn (string $id) => expect(app(Outbox::class)->consume($id, SearchConsumer::class))->toBeTrue());

    AddRelation::run(actor($mara), $item, ['type_id' => RelationType::query()->where('built_in', 'relates')->value('id'), 'target_id' => $other->id]);
    SetSubscription::run(actor($mara), $item, true);
    ToggleFavorite::run(actor($mara), ['kind' => 'project', 'id' => $web->id]);
    CreateToken::run(actor($mara), ['name' => 'Laptop', 'abilities' => ['read']]);
    AddMember::run(actor($mara), $web, ['user_id' => User::factory()->create()->id, 'role' => 'member']);

    expect($catalog)->not->toBeEmpty()
        ->and(Event::query()->whereIn('type', [EventType::WorkItemRelationAdded, EventType::WorkItemSubscribed, EventType::FavoriteAdded,
            EventType::TokenCreated, EventType::ProjectMemberAdded])->count())->toBe(6)
        ->and($engine->writes())->toBe(0);
});

it('consumes an event once', function () use ($world, $create) {
    consumers();
    $engine = searchEngine();
    [$web, $mara] = $world();
    $item = $create($web, $mara);
    $event = eventsOf(EventType::WorkItemCreated, $item)->sole();
    consumers(SearchConsumer::class);

    expect(app(Outbox::class)->consume($event->id, SearchConsumer::class))->toBeTrue()
        ->and(app(Outbox::class)->consume($event->id, SearchConsumer::class))->toBeFalse()
        ->and($engine->writes())->toBe(1)
        ->and(array_keys($engine->documents('testing_work_items')))->toBe([$item->id]);
});

it('retries with its own tries and backoff', function () {
    $consumer = app(SearchConsumer::class);
    $job = new ConsumeEvent('x', SearchConsumer::class);

    // 8 tries, 7 pauses (the last one repeats): about 3 h 20 min before the job ends in failed_jobs (P12)
    expect([$consumer->key(), $consumer->queue()])->toBe(['search', 'search'])
        ->and($job->tries())->toBe(8)
        ->and($job->backoff())->toBe([10, 60, 300, 900, 3600]);
});
