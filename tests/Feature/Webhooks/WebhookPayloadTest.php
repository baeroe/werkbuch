<?php

use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Actions\Comments\AddComment;
use App\Actions\Comments\DeleteComment;
use App\Actions\Comments\EditComment;
use App\Actions\Pages\CreatePage;
use App\Actions\Pages\DeletePage;
use App\Actions\Pages\UpdatePage;
use App\Actions\Projects\DeleteProject;
use App\Actions\Projects\UpdateProject;
use App\Actions\Templates\RunTemplate;
use App\Actions\WorkItems\AddRelation;
use App\Actions\WorkItems\CreateWorkItem;
use App\Actions\WorkItems\DeleteWorkItem;
use App\Actions\WorkItems\UpdateWorkItem;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Http\Resources\UserResource;
use App\Models\Comment;
use App\Models\Event;
use App\Models\Project;
use App\Models\RelationType;
use App\Models\Template;
use App\Models\TemplateRun;
use App\Models\User;
use App\Models\Webhook;
use App\Models\WorkItem;
use App\Support\Actor;
use App\Webhooks\EventData;
use App\Webhooks\WebhookPayload;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

// The body of a webhook (plan "Payload und Header", A362, A363): the envelope of the event, `data` from the resources
// as REST reads them for one reader (the bot of the webhook, else the default bot), `changes` with the relation ends
// resolved for that reader, and never anything of `meta`.

beforeEach(function () {
    Storage::fake('local');
});

/**
 * WEB (public) with Mara as admin and lead and Kira, a bot and member of WEB; OPS (private) with Mara as member, which
 * Kira does not see.
 *
 * @return array{web: Project, ops: Project, mara: User, kira: User}
 */
$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara', 'handle' => 'mara']);
    $web = Project::factory()->identifier('WEB')->public()->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $ops = Project::factory()->identifier('OPS')->private()->member($mara, ProjectRole::Member)->create(['lead_id' => $mara->id]);
    $kira = User::factory()->bot()->create(['name' => 'Kira', 'handle' => 'kira']);
    app(RoleAssignments::class)->setProjectRole($kira, $web, ProjectRole::Member);

    return ['web' => $web, 'ops' => $ops, 'mara' => $mara, 'kira' => $kira];
};

/**
 * The payload as the receiver reads it: through JSON, as task 6 sends it.
 *
 * @return array<string, mixed>
 */
$payload = fn (Event $event, User $reader): array => json_decode((string) json_encode(WebhookPayload::for($event, $reader)), true);

/**
 * What REST answers the reader for a path (`data`), through the reader's own token.
 *
 * @return array<string, mixed>
 */
$rest = function (User $reader, string $path): array {
    forgetApiAuth();

    return test()->withToken(apiToken($reader, ['read']))->getJson("/api/v1/{$path}")->assertOk()->json('data');
};

/**
 * An account as UserResource shows it (there is no `GET /users/{id}`; nothing of it depends on the reader).
 *
 * @return array<string, mixed>
 */
$user = fn (User $account): array => json_decode((string) json_encode((new UserResource($account))->resolve()), true);

$item = fn (User $mara, Project $project, array $input = []): WorkItem => CreateWorkItem::run(actor($mara), ['project_id' => $project->id, 'title' => 'Absturz', ...$input]);

$blocks = fn (): RelationType => RelationType::query()->where('built_in', 'blocks')->firstOrFail();

it('sends the item as REST reads it, Markdown and JSON', function () use ($world, $payload, $rest, $item) {
    $w = $world();
    $item = $item($w['mara'], $w['web']);
    UpdateWorkItem::run(actor($w['mara']), $item, ['description' => "Nach **@kira** fragen.\n\n- eins"]);
    $event = eventsOf(EventType::WorkItemUpdated, $item)->sole();

    $body = $payload($event, $w['kira']);

    expect(array_keys($body))->toBe(['id', 'event', 'occurred_at', 'actor', 'project', 'data', 'changes'])
        ->and($body['id'])->toBe($event->id)
        ->and($body['event'])->toBe('work_item.updated')
        ->and($body['occurred_at'])->toBe($event->occurred_at->utc()->format('Y-m-d\TH:i:s.u\Z'))
        ->and($body['actor'])->toBe(['id' => $w['mara']->id, 'type' => 'person', 'name' => 'Mara', 'handle' => 'mara'])
        ->and($body['project'])->toBe(['id' => $w['web']->id, 'identifier' => 'WEB'])
        ->and($body['changes'])->toBe(json_decode((string) json_encode($event->changes), true))
        // the item in full as the reader's REST reads it, the description as Markdown and as Tiptap JSON
        ->and($body['data'])->toEqual($rest($w['kira'], "work-items/{$item->id}"))
        ->and($body['data']['description'])->toContain('@kira')
        ->and($body['data']['description_json']['type'])->toBe('doc');
});

it('answers my_role for the reader', function () use ($world, $payload, $rest) {
    $w = $world();
    UpdateProject::run(actor($w['mara']), $w['web'], ['name' => 'Website neu']);
    $event = eventsOf(EventType::ProjectUpdated, $w['web'])->sole();

    $asBot = $payload($event, $w['kira'])['data'];
    $asDefault = $payload($event, User::defaultBot())['data'];

    expect($asBot)->toEqual($rest($w['kira'], "projects/{$w['web']->id}"))
        ->and([$asBot['name'], $asBot['my_role'], $asBot['is_member']])->toBe(['Website neu', 'member', true])
        ->and([$asDefault['my_role'], $asDefault['is_member']])->toBe(['admin', false]);
});

it('hides a relation to an item the bot cannot see', function () use ($world, $payload, $item, $blocks) {
    $w = $world();
    $source = $item($w['mara'], $w['web']);
    $target = $item($w['mara'], $w['ops']);
    AddRelation::run(actor($w['mara']), $source, ['type_id' => $blocks()->id, 'target_id' => $target->id]);
    $event = eventsOf(EventType::WorkItemRelationAdded, $source)->sole();

    $body = $payload($event, $w['kira']);
    $json = (string) json_encode($body);

    expect($body['changes']['relation'])->toBe(['old' => null, 'new' => ['label' => 'blocks', 'hidden' => true]])
        ->and($json)->not->toContain($target->id)->not->toContain('OPS-1');
});

it('names a reference into another project to a project webhook without bot', function () use ($world, $payload, $item, $blocks) {
    $w = $world();
    $source = $item($w['mara'], $w['web']);
    $target = $item($w['mara'], $w['ops']);
    AddRelation::run(actor($w['mara']), $source, ['type_id' => $blocks()->id, 'target_id' => $target->id]);
    $event = eventsOf(EventType::WorkItemRelationAdded, $source)->sole();

    // without a bot the default bot reads, like an org admin (K10, A363)
    expect($payload($event, User::defaultBot())['changes']['relation']['new'])
        ->toBe(['label' => 'blocks', 'item_id' => $target->id, 'key' => 'OPS-1']);
});

it('sends a comment as REST reads it, with its item lean', function () use ($world, $payload, $rest, $item) {
    $w = $world();
    $item = $item($w['mara'], $w['web']);
    $comment = AddComment::run(actor($w['mara']), $item, ['body' => 'Gesehen, **danke**.']);
    $event = eventsOf(EventType::CommentCreated, $item)->sole();

    $data = $payload($event, $w['kira'])['data'];

    $lean = $rest($w['kira'], "work-items/{$item->id}");
    unset($lean['description'], $lean['description_json'], $lean['values_markdown']);
    expect($data)->toEqual([...$rest($w['kira'], "comments/{$comment->id}"), 'work_item' => $lean])
        ->and($data['body'])->toBe('Gesehen, **danke**.')
        ->and($data['work_item'])->not->toHaveKey('description');
});

it('sends no text of a deleted comment', function () use ($world, $payload, $item) {
    $w = $world();
    $item = $item($w['mara'], $w['web']);
    $comment = AddComment::run(actor($w['mara']), $item, ['body' => 'Geheimer Plan']);
    EditComment::run(actor($w['mara']), $comment, ['body' => 'Noch geheimerer Plan']);
    DeleteComment::run(actor($w['mara']), Comment::query()->findOrFail($comment->id));

    $updated = $payload(eventsOf(EventType::CommentUpdated, $item)->sole(), User::defaultBot());
    $deleted = $payload(eventsOf(EventType::CommentDeleted, $item)->sole(), User::defaultBot());

    expect([$updated['data'], $updated['changes']])->toBe([null, null])
        ->and(json_encode($updated))->not->toContain('geheim')
        ->and($deleted['data'])->toBe(['id' => $comment->id, 'work_item_id' => $item->id, 'author_id' => $w['mara']->id])
        ->and($deleted['changes'])->toBeNull();
});

it('sends the text of an edited comment while the comment is there', function () use ($world, $payload, $item) {
    $w = $world();
    $item = $item($w['mara'], $w['web']);
    $comment = AddComment::run(actor($w['mara']), $item, ['body' => 'Alt']);
    EditComment::run(actor($w['mara']), $comment, ['body' => 'Neu']);

    $body = $payload(eventsOf(EventType::CommentUpdated, $item)->sole(), User::defaultBot());

    expect($body['data']['body'])->toBe('Neu')
        ->and(array_keys($body['changes']))->toBe(['body'])
        ->and($body['changes']['body']['new']['type'])->toBe('doc');
});

it('sends work_item.deleted from meta', function () use ($world, $payload, $item) {
    $w = $world();
    $item = $item($w['mara'], $w['web'], ['title' => 'Weg damit']);
    DeleteWorkItem::run(actor($w['mara']), $item);

    $body = $payload(eventsOf(EventType::WorkItemDeleted, $item)->sole(), User::defaultBot());

    expect($body['data'])->toBe(['id' => $item->id, 'key' => 'WEB-1', 'title' => 'Weg damit'])
        ->and($body['changes'])->toBeNull();
});

it('sends project.deleted from meta, with the project it names', function () use ($world, $payload) {
    $w = $world();
    DeleteProject::run(actor($w['mara']), $w['web']);
    // the purge has run (sync queue): only the event knows the project
    expect(Project::query()->find($w['web']->id))->toBeNull();

    $body = $payload(eventsOf(EventType::ProjectDeleted, $w['web'])->sole(), User::defaultBot());

    expect($body['data'])->toBe(['id' => $w['web']->id, 'identifier' => 'WEB', 'name' => $w['web']->name])
        ->and($body['project'])->toBe(['id' => $w['web']->id, 'identifier' => 'WEB']);
});

it('sends a page as REST reads it, and its changes without text', function () use ($world, $payload, $rest) {
    $w = $world();
    $page = CreatePage::run(actor($w['mara']), $w['web'], ['title' => 'Handbuch', 'content' => 'Erster **Schritt**']);
    UpdatePage::run(actor($w['mara']), $page, ['content' => 'Zweiter Schritt']);

    $created = $payload(eventsOf(EventType::PageCreated, $page)->sole(), $w['kira']);
    $updated = $payload(eventsOf(EventType::PageUpdated, $page)->sole(), $w['kira']);

    expect($created['data']['title'])->toBe('Handbuch')
        ->and($updated['data'])->toEqual($rest($w['kira'], "pages/{$page->id}"))
        ->and($updated['data']['content'])->toBe('Zweiter Schritt')
        ->and(array_keys($updated['changes']))->toBe(['version']);
});

it('sends page.deleted with all page_ids', function () use ($world, $payload) {
    $w = $world();
    $root = CreatePage::run(actor($w['mara']), $w['web'], ['title' => 'Handbuch']);
    $child = CreatePage::run(actor($w['mara']), $w['web'], ['title' => 'Kapitel', 'parent_id' => $root->id]);
    DeletePage::run(actor($w['mara']), $root);

    $body = $payload(eventsOf(EventType::PageDeleted, $root)->sole(), User::defaultBot());

    expect($body['data'])->toBe(['id' => $root->id, 'title' => 'Handbuch', 'page_ids' => [$root->id, $child->id]])
        ->and($body['changes'])->toBeNull();
});

it('sends bot.mentioned with source and comment', function () use ($world, $payload, $rest, $user, $item) {
    $w = $world();
    $item = $item($w['mara'], $w['web']);
    $comment = AddComment::run(actor($w['mara']), $item, ['body' => '@kira bitte ansehen']);
    UpdateWorkItem::run(actor($w['mara']), $item, ['description' => '@kira auch hier']);
    [$inComment, $inDescription] = eventsOf(EventType::BotMentioned, $item)->all();

    $fromComment = $payload($inComment, $w['kira'])['data'];
    $fromDescription = $payload($inDescription, $w['kira'])['data'];

    expect(array_keys($fromComment))->toBe(['bot', 'item', 'source', 'comment'])
        ->and($fromComment['bot'])->toEqual($user($w['kira']))
        ->and($fromComment['item'])->toEqual($rest($w['kira'], "work-items/{$item->id}"))
        ->and($fromComment['source'])->toBe('comment')
        ->and($fromComment['comment'])->toEqual($rest($w['kira'], "comments/{$comment->id}"))
        ->and([$fromDescription['source'], $fromDescription['comment']])->toBe(['description', null]);
});

it('sends bot.mentioned without a comment that is gone', function () use ($world, $payload, $item) {
    $w = $world();
    $item = $item($w['mara'], $w['web']);
    $comment = AddComment::run(actor($w['mara']), $item, ['body' => '@kira bitte ansehen']);
    DeleteComment::run(actor($w['mara']), $comment);

    $data = $payload(eventsOf(EventType::BotMentioned, $item)->sole(), $w['kira'])['data'];

    expect([$data['source'], $data['comment'], $data['item']['id']])->toBe(['comment', null, $item->id]);
});

it('sends bot.assigned with the bot and the item', function () use ($world, $payload, $rest, $user, $item) {
    $w = $world();
    $item = $item($w['mara'], $w['web'], ['assignee_id' => $w['kira']->id]);
    // recorded by UpdateWorkItem from task 10 on; its form: the item as subject, the bot in `meta.bot_id`
    DB::transaction(fn () => EventRecorder::record(EventType::BotAssigned, actor($w['mara']), $item, $w['web'], null, ['bot_id' => $w['kira']->id]));

    $data = $payload(eventsOf(EventType::BotAssigned, $item)->sole(), $w['kira'])['data'];

    expect(array_keys($data))->toBe(['bot', 'item'])
        ->and($data['bot'])->toEqual($user($w['kira']))
        ->and($data['item'])->toEqual($rest($w['kira'], "work-items/{$item->id}"));
});

it('sends template.run_failed with its template', function () use ($world, $payload) {
    $w = $world();
    $template = Template::factory()->create(['project_id' => $w['web']->id, 'created_by' => $w['mara']->id]);
    // an assignee who is no member of WEB: the run fails
    $template->update(['payload' => [...$template->payload, 'assignee_id' => User::factory()->create()->id]]);
    RunTemplate::run(actor($w['mara']), $template);
    $event = eventsOf(EventType::TemplateRunFailed, $template)->sole();
    $run = TemplateRun::query()->sole();

    $body = $payload($event, User::defaultBot());

    expect($body['data'])->toMatchArray([
        'id' => $run->id, 'template_id' => $template->id, 'status' => TemplateRun::FAILED, 'error' => $run->error, 'work_item_id' => null,
    ])
        ->and([$body['data']['template']['id'], $body['data']['template']['name']])->toBe([$template->id, $template->name])
        // lean: the template without its texts
        ->and($body['data']['template']['payload'])->not->toHaveKey('description')
        ->and($body['actor']['id'])->toBe(User::defaultBot()->id)
        ->and($body['changes'])->toBeNull();

    // the template is deleted, its runs with it: nothing left to send
    $template->delete();
    expect($payload($event, User::defaultBot())['data'])->toBeNull();
});

it('never sends meta', function () use ($world, $item) {
    $w = $world();
    $ida = memberOf($w['web'], ProjectRole::Member, ['name' => 'Ida', 'handle' => 'ida']);
    $item = $item($w['mara'], $w['web']);
    $actor = (new Actor($w['mara'], Actor::VIA_UI, 'auto_close', null, '123.456'))->onBehalfOf($ida)->quietly();
    UpdateWorkItem::run($actor, $item, ['description' => '@ida schau mal']);
    $event = eventsOf(EventType::WorkItemUpdated, $item)->sole();
    expect($event->meta)->toHaveKeys(['via', 'reason', 'socket', 'on_behalf_of', 'quiet', 'mentioned']);

    $json = (string) json_encode(WebhookPayload::for($event, User::defaultBot()));

    foreach (['"meta"', '"via"', '"reason"', '"socket"', '123.456', '"on_behalf_of"', '"quiet"', '"mentioned"', 'auto_close'] as $part) {
        expect($json)->not->toContain($part);
    }
});

it('answers data null when the subject is gone', function () use ($world, $payload, $item) {
    $w = $world();
    $item = $item($w['mara'], $w['web']);
    UpdateWorkItem::run(actor($w['mara']), $item, ['title' => 'Neuer Titel']);
    AddComment::run(actor($w['mara']), $item, ['body' => '@kira bitte ansehen']);
    $page = CreatePage::run(actor($w['mara']), $w['web'], ['title' => 'Handbuch']);
    $updated = eventsOf(EventType::WorkItemUpdated, $item)->sole();
    $mentioned = eventsOf(EventType::BotMentioned, $item)->sole();
    $created = eventsOf(EventType::PageCreated, $page)->sole();
    DeleteWorkItem::run(actor($w['mara']), $item);
    DeletePage::run(actor($w['mara']), $page);

    $body = $payload($updated, User::defaultBot());

    // the delivery goes all the same, with the changes of its event (A362)
    expect($body['data'])->toBeNull()
        ->and($body['changes']['title']['new'])->toBe('Neuer Titel')
        ->and($payload($mentioned, $w['kira'])['data'])->toBeNull()
        ->and($payload($created, User::defaultBot())['data'])->toBeNull();
});

it('answers data null for a reader who does not see the subject', function () use ($world, $payload, $item) {
    $w = $world();
    $item = $item($w['mara'], $w['ops']);
    $page = CreatePage::run(actor($w['mara']), $w['ops'], ['title' => 'Betrieb']);
    DB::transaction(fn () => EventRecorder::record(EventType::ProjectUpdated, actor($w['mara']), $w['ops'], $w['ops'], ['name' => ['old' => 'a', 'new' => 'b']]));

    expect($payload(eventsOf(EventType::WorkItemCreated, $item)->sole(), $w['kira'])['data'])->toBeNull()
        ->and($payload(eventsOf(EventType::PageCreated, $page)->sole(), $w['kira'])['data'])->toBeNull()
        ->and($payload(eventsOf(EventType::ProjectUpdated, $w['ops'])->sole(), $w['kira'])['data'])->toBeNull();
});

it('answers data null for an event no webhook can choose', function () use ($world) {
    $w = $world();
    $created = eventsOf(EventType::BotCreated)->first();

    expect($created)->not->toBeNull()
        ->and(EventData::of($created, $w['kira']))->toBeNull()
        // an event of no project names none
        ->and(WebhookPayload::for($created, $w['kira'])['project'])->toBeNull();
});

it('pings with the webhook and no changes', function () use ($world) {
    $w = $world();
    $webhook = Webhook::factory()->create(['name' => 'Agent', 'created_by' => $w['mara']->id]);

    $body = WebhookPayload::ping($webhook, $w['mara'], '01jdelivery0000000000000000');

    expect(array_keys($body))->toBe(['id', 'event', 'occurred_at', 'actor', 'project', 'data', 'changes'])
        ->and([$body['id'], $body['event'], $body['project'], $body['changes']])->toBe(['01jdelivery0000000000000000', 'ping', null, null])
        ->and($body['data'])->toBe(['webhook' => ['id' => $webhook->id, 'name' => 'Agent']])
        ->and($body['actor'])->toBe(['id' => $w['mara']->id, 'type' => 'person', 'name' => 'Mara', 'handle' => 'mara'])
        ->and($body['occurred_at'])->toMatch('/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/');

    $forWeb = Webhook::factory()->forProject($w['web'])->create(['created_by' => $w['mara']->id]);
    expect(WebhookPayload::ping($forWeb, $w['mara'], 'x')['project'])->toBe(['id' => $w['web']->id, 'identifier' => 'WEB']);
});

it('asks as often for an item with 20 relations as for one with one', function () use ($world, $item, $blocks) {
    $w = $world();
    $count = function (int $relations) use ($w, $item, $blocks): int {
        $source = $item($w['mara'], $w['web']);
        foreach (range(1, $relations) as $n) {
            // half of them to OPS, which Kira does not see; the last one (the event counted) to WEB
            $other = $item($w['mara'], $n < $relations && $n % 2 === 0 ? $w['ops'] : $w['web']);
            AddRelation::run(actor($w['mara']), $source, ['type_id' => $blocks()->id, 'target_id' => $other->id]);
        }
        UpdateWorkItem::run(actor($w['mara']), $source, ['title' => "Mit {$relations}"]);
        $event = eventsOf(EventType::WorkItemUpdated, $source)->sole();
        $relation = eventsOf(EventType::WorkItemRelationAdded, $source)->last();

        // once to fill what a process keeps (organization, roles, catalog), then counted
        WebhookPayload::for($event, $w['kira']);
        WebhookPayload::for($relation, $w['kira']);
        DB::flushQueryLog();
        DB::enableQueryLog();
        WebhookPayload::for($event, $w['kira']);
        WebhookPayload::for($relation, $w['kira']);
        $queries = count(DB::getQueryLog());
        DB::disableQueryLog();

        return $queries;
    };

    expect($count(20))->toBe($count(1));
});

// every event of the catalog has a branch of its own; one without would throw instead of reading the subject as an
// item (T5-M3); an event outside the catalog has no data
it('has data for every event of the catalog and none for the others', function () {
    $event = fn (EventType $type): Event => (new Event)->forceFill([
        'type' => $type, 'subject_type' => 'work_item', 'subject_id' => (string) Str::ulid(), 'meta' => [],
    ]);

    foreach (EventType::cases() as $type) {
        $data = EventData::of($event($type), User::defaultBot());
        expect($data === null || is_array($data))->toBeTrue();
        if (! $type->webhook()) {
            expect($data)->toBeNull();
        }
    }
});
