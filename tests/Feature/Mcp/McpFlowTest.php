<?php

use App\Actions\Notifications\SendNotificationMail;
use App\Domain\Webhooks\Signature;
use App\Jobs\SendNotificationMailJob;
use App\Mail\NotificationDigest;
use App\Models\Event;
use App\Models\NotificationMail;
use App\Models\User;
use App\Models\WebhookDelivery;
use App\Models\WorkItem;
use App\Notifications\NotificationConsumer;
use App\Search\SearchConsumer;
use App\Support\Actor;
use App\Webhooks\WebhookConsumer;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
use Tests\Support\Mcp\McpClient;

/*
 * The acceptance of phase 13 (task 12, K3, K7, K14): success criterion 2 of the spec, criterion 4 and the agent scenario
 * of spec 6.2 over MCP alone, the way an agent does it: `server/discover`, `tools/list`, then `tools/call` in the current
 * protocol (every request with `_meta` and the headers `Mcp-Method`/`Mcp-Name`; the legacy handshake is McpRouteTest's),
 * with tokens of an org admin, of Mara and of the bot Kira, all `read`, `write` and `mcp`. Only criterion 4 also asks
 * REST, to compare. The mail goes through the job only when a mail server is set up (the array mailer counts as none),
 * so the test sets one and holds the job; a webhook sends right after the commit (the sync queue), into `Http::fake`.
 */

beforeEach(function () {
    config(['mail.default' => 'smtp']);
    Mail::fake();
    Queue::fake([SendNotificationMailJob::class]);
    resolver(['receiver.example.com' => ['93.184.216.34']]);
    Http::fake(['https://receiver.example.com/*' => Http::response('thanks')]);
    consumers(SearchConsumer::class, NotificationConsumer::class, WebhookConsumer::class);
});

/** What an agent does before its first call: `server/discover`, then `tools/list`; the client, with the names of its tools. */
$connect = function (McpClient $mcp, string ...$tools): McpClient {
    $mcp->discover();
    $names = array_column($mcp->tools(), 'name');
    foreach ($tools as $tool) {
        expect($names)->toContain($tool);
    }

    return $mcp;
};

/** The structured content of a result that is no error (the whole result as the message when it is one). */
$ok = function (array $result): array {
    expect($result['isError'])->toBeFalse((string) json_encode($result));

    return $result['structuredContent'];
};

/** The problem of a result that is an error. */
$problem = function (array $result): array {
    expect($result['isError'])->toBeTrue((string) json_encode($result));

    return $result['structuredContent'];
};

it('runs success criterion 2 over MCP only', function () use ($connect, $ok, $problem) {
    $engine = searchEngine();
    $admin = User::factory()->admin()->create(['name' => 'Erik Ende', 'handle' => 'erik']);
    $maraUser = User::factory()->create(['name' => 'Mara Lindqvist', 'handle' => 'mara']);
    $kiraUser = User::factory()->bot($admin)->create(['name' => 'Kira', 'handle' => 'kira']);
    $before = Event::query()->pluck('id')->all();
    $erik = $connect(McpClient::for($this, apiToken($admin, ['read', 'write', 'mcp'])), 'manage-organization', 'manage-projects', 'manage-webhooks', 'organization');
    $mara = $connect(McpClient::for($this, apiToken($maraUser, ['read', 'write', 'mcp'])), 'manage-work-items', 'notifications', 'search');
    $kira = $connect(McpClient::for($this, apiToken($kiraUser, ['read', 'write', 'mcp'])), 'manage-comments');

    // (1) a workflow with a matrix that has no step from Backlog straight to Done, a project, the workflow assigned
    $workflow = $ok($erik->call('manage-organization', ['action' => 'create-workflow', 'input' => [
        'name' => 'Mit Arbeit',
        'description' => 'Nichts wird fertig, ohne angefangen zu sein.',
        'is_default' => false,
        'is_free' => false,
        'initial_state_id' => 'backlog',
        'states' => [
            ['id' => 'backlog', 'name' => 'Backlog', 'icon' => 'dashed', 'category' => 'backlog'],
            ['id' => 'progress', 'name' => 'In Progress', 'icon' => 'half', 'category' => 'started'],
            ['id' => 'done', 'name' => 'Done', 'icon' => 'check', 'category' => 'completed'],
        ],
        'transitions' => [['backlog', 'progress'], ['progress', 'done'], ['progress', 'backlog']],
    ]]))['data'];
    $state = collect($workflow['states'])->pluck('id', 'name');

    $project = $ok($erik->call('manage-projects', ['action' => 'create', 'input' => ['name' => 'Website', 'identifier' => 'WEB', 'lead_id' => $admin->id]]))['data'];
    $ok($erik->call('manage-projects', ['action' => 'add-member', 'project' => 'WEB', 'input' => ['user_id' => $maraUser->id, 'role' => 'member']]));
    $ok($erik->call('manage-projects', ['action' => 'add-member', 'project' => 'WEB', 'input' => ['user_id' => $kiraUser->id, 'role' => 'member']]));

    // an item in the Backlog of the standard workflow, so the change of the workflow needs a mapping
    $old = $ok($mara->call('manage-work-items', ['action' => 'create', 'input' => ['project_id' => 'WEB', 'title' => 'Altlast']]))['data'];
    $standard = $ok($erik->call('organization', ['action' => 'get-workflow', 'id' => $project['workflow_id']]))['data'];
    $oldBacklog = collect($standard['states'])->firstWhere('name', 'Backlog')['id'];
    expect($old['state_id'])->toBe($oldBacklog);

    $refused = $problem($erik->call('manage-projects', ['action' => 'set-workflow', 'project' => 'WEB', 'input' => ['workflow_id' => $workflow['id'], 'mapping' => []]]));
    expect($refused['status'])->toBe(422)
        ->and(array_keys($refused['errors']))->toBe(["mapping.{$oldBacklog}"])
        ->and($refused['states'])->toBe([['state_id' => $oldBacklog, 'name' => 'Backlog', 'items' => 1]]);
    $assigned = $ok($erik->call('manage-projects', ['action' => 'set-workflow', 'project' => 'WEB', 'input' => ['workflow_id' => $workflow['id'], 'mapping' => [$oldBacklog => $state['Backlog']]]]));
    expect($assigned['data']['workflow_id'])->toBe($workflow['id'])
        ->and($ok($mara->call('work-items', ['action' => 'get', 'item' => $old['key']]))['data']['state_id'])->toBe($state['Backlog']);

    // (2) a required text property, a type that asks for it, switched on in the project
    $customer = $ok($erik->call('manage-organization', ['action' => 'create-property', 'input' => [
        'key' => 'customer', 'label' => 'Kunde', 'field_type' => 'text', 'help' => 'Für wen das Item gemacht wird.',
        'settings' => [], 'options' => [], 'default_value' => null,
    ]]))['data']['id'];
    $wish = $ok($erik->call('manage-organization', ['action' => 'create-type', 'input' => [
        'name' => 'Kundenwunsch', 'icon' => 'message-square-heart', 'tone' => 'plum', 'description' => 'Ein Wunsch einer Kundin.',
        'is_epic' => false, 'properties' => [['property_id' => $customer, 'required' => true]],
    ]]))['data'];
    expect($wish['properties'][0])->toMatchArray(['property_id' => $customer, 'required' => true]);
    $enabled = [...$project['enabled_type_ids'], $wish['id']];
    expect($ok($erik->call('manage-projects', ['action' => 'update', 'project' => 'WEB', 'input' => ['enabled_type_ids' => $enabled]]))['data']['enabled_type_ids'])->toBe($enabled);

    $item = ['project_id' => 'WEB', 'type_id' => $wish['id'], 'title' => 'Kontaktformular mit Rückruf'];
    $missing = $problem($mara->call('manage-work-items', ['action' => 'create', 'input' => $item]));
    expect($missing['status'])->toBe(422)
        ->and($missing['errors'])->toBe(['values.customer' => [__('field.values.required', ['label' => 'Kunde'])]])
        ->and(WorkItem::query()->where('title', $item['title'])->exists())->toBeFalse('the refused item was written');
    $created = $ok($mara->call('manage-work-items', ['action' => 'create', 'input' => [...$item, 'values' => ['customer' => 'Studio Nordlicht']]]))['data'];
    $key = $created['key'];
    expect($created['values']['customer'])->toBe('Studio Nordlicht')
        ->and($created['state_id'])->toBe($state['Backlog']);

    // (3) the matrix holds: Backlog → Done is refused, Backlog → In Progress goes
    $notAllowed = $problem($mara->call('manage-work-items', ['action' => 'transition', 'item' => $key, 'input' => ['to_state_id' => $state['Done']]]));
    expect($notAllowed['status'])->toBe(409)
        ->and($notAllowed['reason'])->toBe('transition_not_allowed');
    $moved = $ok($mara->call('manage-work-items', ['action' => 'transition', 'item' => $key, 'input' => ['to_state_id' => $state['In Progress']]]));
    expect($moved['data']['state_id'])->toBe($state['In Progress']);

    // (5, set up first) a webhook of the project for every comment event, on a receiver behind the fake DNS
    $hook = $ok($erik->call('manage-webhooks', ['action' => 'create', 'input' => [
        'name' => 'Empfänger', 'url' => 'https://receiver.example.com/hook', 'project_id' => $project['id'],
        'events' => ['comment.*'], 'bot_id' => null, 'active' => true,
    ]]));
    $secret = $hook['secret'];
    expect($hook['data']['events'])->toBe(['comment.*'])
        ->and(str_starts_with($secret, 'whsec_'))->toBeTrue('the secret of create is no secret');
    Http::assertNothingSent();

    // (4) the bot comments with @mara in Markdown: Mara's inbox has the mention, a collection with a mail opens
    $comment = $ok($kira->call('manage-comments', ['action' => 'add', 'item' => $key, 'input' => ['body' => '@mara kannst du den Rückruf freigeben?']]))['data'];
    expect($comment['body'])->toBe('@mara kannst du den Rückruf freigeben?');

    $mentions = $ok($mara->call('notifications', ['action' => 'list', 'filter' => ['event' => 'mentioned']]));
    expect($mentions['meta']['total'])->toBe(1)
        ->and($mentions['data'][0])->toMatchArray([
            'event' => 'mentioned', 'actor_id' => $kiraUser->id, 'read_at' => null,
            'data' => ['source' => 'comment', 'comment_id' => $comment['id']],
        ])
        ->and($mentions['data'][0]['item']['key'])->toBe($key);
    $all = $ok($mara->call('notifications', ['action' => 'list']));
    expect($all['meta']['total'])->toBeGreaterThan(0);

    $collection = NotificationMail::query()->where('user_id', $maraUser->id)->sole();
    Mail::assertNothingSent();
    expect(SendNotificationMail::run(Actor::system(User::defaultBot(), 'notification_mail'), $collection->id))->toBe(NotificationMail::SENT);
    Mail::assertSent(NotificationDigest::class, fn (NotificationDigest $mail) => $mail->hasTo($maraUser->email));

    // (5) the comment of (4) went to the receiver, once, signed with the secret of the result of create
    $delivery = WebhookDelivery::query()->where('webhook_id', $hook['data']['id'])->sole();
    expect($delivery->event)->toBe('comment.created')
        ->and($delivery->status)->toBe(WebhookDelivery::SUCCEEDED);
    Http::assertSentCount(1);
    /** @var Request $sent */
    $sent = Http::recorded()->sole()[0];
    $payload = json_decode($sent->body(), true);
    $timestamp = (int) $sent->header('X-Werkbuch-Timestamp')[0];
    $signature = $sent->header('X-Werkbuch-Signature')[0];
    expect($sent->url())->toBe('https://receiver.example.com/hook')
        ->and($sent->header('X-Werkbuch-Event'))->toBe(['comment.created'])
        ->and($sent->header('X-Werkbuch-Delivery'))->toBe([$delivery->id])
        ->and($payload['data']['id'])->toBe($comment['id'])
        ->and($payload['data']['work_item']['key'])->toBe($key)
        ->and(Signature::verify($secret, $timestamp, $sent->body(), $signature, time()))->toBeTrue('the signature does not verify with the secret of create')
        ->and(Signature::verify("{$secret}x", $timestamp, $sent->body(), $signature, time()))->toBeFalse('any secret verifies');

    // (6) the search finds the item by a word of its title, and the key jumps to it
    $byWord = $ok($mara->call('search', ['q' => 'Rückruf', 'types' => ['items']]))['data'];
    expect(array_column($byWord['items'], 'id'))->toBe([$created['id']])
        ->and($byWord['key_match'])->toBeNull();
    $byKey = $ok($mara->call('search', ['q' => $key, 'types' => ['items']]))['data'];
    expect($byKey['key_match'])->toBe($created['id'])
        ->and($byKey['items'][0]['id'])->toBe($created['id'])
        ->and($engine->documents('testing_work_items'))->toHaveCount(2);

    // every event of the run came through MCP
    $events = Event::query()->whereNotIn('id', $before)->get();
    expect($events->map(fn (Event $event) => $event->type->value)->all())->toContain('workflow.created', 'project.created', 'project.member_added', 'property.created', 'work_item_type.created', 'work_item.created', 'work_item.state_changed', 'webhook.created', 'comment.created')
        ->and($events->map(fn (Event $event) => [$event->type->value, $event->meta['via'] ?? null])->unique()->filter(fn (array $row) => $row[1] !== 'mcp')->values()->all())->toBe([]);
});

it('runs success criterion 4 over MCP', function () use ($connect, $ok) {
    $admin = User::factory()->admin()->create(['name' => 'Erik Ende', 'handle' => 'erik']);
    $maraUser = User::factory()->create(['name' => 'Mara Lindqvist', 'handle' => 'mara']);
    $maraToken = apiToken($maraUser, ['read', 'write', 'mcp']);
    $erik = $connect(McpClient::for($this, apiToken($admin, ['read', 'write', 'mcp'])), 'manage-organization', 'manage-projects', 'manage-work-items', 'views');
    $mara = $connect(McpClient::for($this, $maraToken), 'manage-views', 'views', 'work-items');

    // the property of the organization, a type with it, WEB with Mara, OPS private without her
    $customer = $ok($erik->call('manage-organization', ['action' => 'create-property', 'input' => ['key' => 'customer', 'label' => 'Kunde', 'field_type' => 'text']]))['data'];
    $wish = $ok($erik->call('manage-organization', ['action' => 'create-type', 'input' => [
        'name' => 'Kundenwunsch', 'icon' => 'message-square-heart', 'tone' => 'plum', 'is_epic' => false,
        'properties' => [['property_id' => $customer['id'], 'required' => false]],
    ]]))['data'];
    $web = $ok($erik->call('manage-projects', ['action' => 'create', 'input' => ['name' => 'Website', 'identifier' => 'WEB']]))['data'];
    $ops = $ok($erik->call('manage-projects', ['action' => 'create', 'input' => ['name' => 'Betrieb', 'identifier' => 'OPS', 'visibility' => 'private']]))['data'];
    expect($web['enabled_type_ids'])->toContain($wish['id'])
        ->and($ops['enabled_type_ids'])->toContain($wish['id'])
        ->and($ops['visibility'])->toBe('private');
    $ok($erik->call('manage-projects', ['action' => 'add-member', 'project' => 'WEB', 'input' => ['user_id' => $maraUser->id, 'role' => 'member']]));

    $create = fn (string $project, string $title, ?string $value) => $ok($erik->call('manage-work-items', ['action' => 'create', 'input' => [
        'project_id' => $project, 'title' => $title,
        ...$value === null ? [] : ['type_id' => $wish['id'], 'values' => ['customer' => $value]],
    ]]))['data']['key'];
    $keys = [
        $create('WEB', 'Dachrinne', 'Studio Nordlicht'),
        $create('WEB', 'Anfahrt', 'Nordlicht Reisen'),
        $create('WEB', 'Bestellformular', 'Studio Nordlicht'),
        $create('WEB', 'Zahlung', 'Bäckerei Korn'),
        // the word in the title, not in the property: the filter is on the property
        $create('WEB', 'Nordlicht-Logo', null),
        $create('OPS', 'Abrechnung', 'Studio Nordlicht'),
    ];
    expect($keys)->toBe(['WEB-1', 'WEB-2', 'WEB-3', 'WEB-4', 'WEB-5', 'OPS-1']);

    // Mara's view on the property, in the order of the key, newest first (not the manual order)
    $view = $ok($mara->call('manage-views', ['action' => 'create', 'input' => [
        'name' => 'Nordlicht', 'icon' => 'layers',
        'filter' => ['version' => 1, 'conditions' => [['field' => 'property:customer', 'op' => 'contains', 'value' => 'Nordlicht']]],
        'display' => ['layout' => 'list', 'group_by' => 'none', 'sort' => ['field' => 'key', 'direction' => 'desc'], 'fields' => ['key', 'title'], 'show_sub_items' => true],
    ]]))['data'];

    // views:items, page after page of two
    $paged = [];
    $cursor = null;
    $pages = 0;
    do {
        $page = $ok($mara->call('views', ['action' => 'items', 'view' => $view['id'], 'per_page' => 2, ...$cursor === null ? [] : ['cursor' => $cursor]]));
        $paged = [...$paged, ...array_column($page['data'], 'key')];
        $cursor = $page['meta']['next_cursor'];
        $pages++;
    } while ($cursor !== null);
    $path = $page['meta']['path'];

    forgetApiAuth();
    $rest = $this->withToken($maraToken)->getJson("/api/v1/work-items?view={$view['id']}")->assertOk();
    $listed = $ok($mara->call('work-items', ['action' => 'list', 'view' => $view['id'], 'per_page' => 100]));
    forgetApiAuth();
    $query = $this->withToken($maraToken)->postJson('/api/v1/work-items/query', ['view_id' => $view['id'], 'per_page' => 2])->assertOk();

    expect($paged)->toBe(['WEB-3', 'WEB-2', 'WEB-1'])
        ->and($pages)->toBe(2)
        ->and($rest->json('data.*.key'))->toBe($paged)
        ->and(array_column($listed['data'], 'key'))->toBe($paged)
        ->and($path)->toBe($query->json('meta.path'))
        ->and($path)->toEndWith('/api/v1/work-items/query');

    // the item of OPS is in the view for whoever sees OPS
    $all = $ok($erik->call('views', ['action' => 'items', 'view' => $view['id'], 'per_page' => 100]));
    expect(array_column($all['data'], 'key'))->toBe(['WEB-3', 'WEB-2', 'WEB-1', 'OPS-1']);
});

it('lets an agent work on what it was assigned', function () use ($connect, $ok) {
    $admin = User::factory()->admin()->create(['name' => 'Erik Ende', 'handle' => 'erik']);
    $maraUser = User::factory()->create(['name' => 'Mara Lindqvist', 'handle' => 'mara']);
    $kiraUser = User::factory()->bot($admin)->create(['name' => 'Kira', 'handle' => 'kira']);
    $erik = $connect(McpClient::for($this, apiToken($admin, ['read', 'write', 'mcp'])), 'manage-projects', 'manage-webhooks');
    $mara = $connect(McpClient::for($this, apiToken($maraUser, ['read', 'write', 'mcp'])), 'manage-work-items');

    $ok($erik->call('manage-projects', ['action' => 'create', 'input' => ['name' => 'Website', 'identifier' => 'WEB']]));
    $ok($erik->call('manage-projects', ['action' => 'add-member', 'project' => 'WEB', 'input' => ['user_id' => $maraUser->id, 'role' => 'member']]));
    $ok($erik->call('manage-projects', ['action' => 'add-member', 'project' => 'WEB', 'input' => ['user_id' => $kiraUser->id, 'role' => 'member']]));
    $hook = $ok($erik->call('manage-webhooks', ['action' => 'create', 'input' => [
        'name' => 'Nur für Kira', 'url' => 'https://receiver.example.com/hook', 'project_id' => null,
        'events' => ['bot.*'], 'bot_id' => $kiraUser->id, 'active' => true,
    ]]))['data'];

    // Mara writes an item and hands it to Kira: Kira's agent is woken once
    $item = $ok($mara->call('manage-work-items', ['action' => 'create', 'input' => ['project_id' => 'WEB', 'title' => 'Kontaktformular prüfen', 'description' => '**Bitte** das Formular auf `/kontakt` prüfen.']]))['data'];
    Http::assertNothingSent();
    $handed = $ok($mara->call('manage-work-items', ['action' => 'update', 'item' => $item['key'], 'input' => ['assignee_id' => $kiraUser->id]]));
    expect($handed['data']['assignee_id'])->toBe($kiraUser->id);

    $delivery = WebhookDelivery::query()->where('webhook_id', $hook['id'])->sole();
    /** @var Request $sent */
    $sent = Http::recorded()->sole()[0];
    $payload = json_decode($sent->body(), true);
    expect($delivery->event)->toBe('bot.assigned')
        ->and($sent->header('X-Werkbuch-Event'))->toBe(['bot.assigned'])
        ->and($payload['data']['item']['key'])->toBe($item['key'])
        ->and($payload['data']['bot']['id'])->toBe($kiraUser->id);

    // Kira's agent: who it is, the item, a comment, the next state
    $kira = $connect(McpClient::for($this, apiToken($kiraUser, ['read', 'write', 'mcp'])), 'whoami', 'work-items', 'manage-comments', 'manage-work-items');
    $me = $ok($kira->call('whoami'))['data'];
    expect($me)->toMatchArray(['id' => $kiraUser->id, 'type' => 'bot', 'handle' => 'kira']);

    $read = $ok($kira->call('work-items', ['action' => 'get', 'item' => $item['key'], 'include' => ['workflow']]))['data'];
    expect($read['description'])->toBe('**Bitte** das Formular auf `/kontakt` prüfen.')
        ->and($read)->not->toHaveKey('description_json')
        ->and($read['assignee_id'])->toBe($kiraUser->id);
    $done = collect($read['workflow']['states'])->firstWhere('category', 'completed')['id'];

    $comment = $ok($kira->call('manage-comments', ['action' => 'add', 'item' => $item['key'], 'input' => ['body' => 'Erledigt.']]))['data'];
    $moved = $ok($kira->call('manage-work-items', ['action' => 'transition', 'item' => $item['key'], 'input' => ['to_state_id' => $done]]))['data'];
    expect($comment)->toMatchArray(['author_id' => $kiraUser->id, 'body' => 'Erledigt.'])
        ->and($moved['state_id'])->toBe($done)
        ->and($moved['closed_at'])->toBeString();

    $history = $ok($kira->call('work-items', ['action' => 'history', 'item' => $item['key']]))['data'];
    $last = collect($history)->last();
    expect($last)->toMatchArray(['type' => 'work_item.state_changed', 'actor_id' => $kiraUser->id, 'via' => 'mcp'])
        ->and($last['changes']['state_id'])->toBe(['old' => $item['state_id'], 'new' => $done])
        ->and($last['changes']['resolution_id']['new'])->toBe($moved['resolution_id']);
    expect(collect($history)->pluck('actor_id')->unique()->values()->all())->toBe([$maraUser->id, $kiraUser->id]);

    // the comment and the move were Kira's own: still the one delivery
    expect(WebhookDelivery::query()->where('webhook_id', $hook['id'])->pluck('event')->all())->toBe(['bot.assigned']);
    Http::assertSentCount(1);
});
