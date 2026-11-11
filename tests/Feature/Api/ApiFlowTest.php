<?php

use App\Actions\Notifications\SendNotificationMail;
use App\Domain\Webhooks\Signature;
use App\Http\Api\ListOf;
use App\Jobs\SendNotificationMailJob;
use App\Live\LiveConsumer;
use App\Mail\NotificationDigest;
use App\Models\NotificationMail;
use App\Models\User;
use App\Models\WebhookDelivery;
use App\Notifications\NotificationConsumer;
use App\Search\SearchConsumer;
use App\Support\Actor;
use App\Webhooks\WebhookConsumer;
use Illuminate\Http\Client\Request;
use Illuminate\Routing\Route as RoutingRoute;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Route;
use Tests\Feature\Access\MatrixWorld;
use Tests\Support\OpenApi\Contract;

/*
 * The acceptance of phase 12: success criterion 2 of the spec over REST alone, the way an integration does it, with
 * Bearer tokens of an org admin, of Mara and of a bot. Every answer stands under the OpenAPI contract (A385; the check
 * runs at the end of the test, and the test asks it once more itself).
 *
 * What REST cannot show: that Mara *sees* the mention live (2.4) is the browser's part (`notifications-acceptance.spec.ts`);
 * here the live part is that `notifications.changed` goes to her channel (K18). The mail goes through the job only
 * when a mail server is set up (K2, K18: the array mailer counts as none), so the test sets one and holds the job.
 */

beforeEach(function () {
    config(['mail.default' => 'smtp']);
    Mail::fake();
    Queue::fake([SendNotificationMailJob::class]);
    resolver(['receiver.example.com' => ['93.184.216.34']]);
    Http::fake(['https://receiver.example.com/*' => Http::response('thanks')]);
    consumers(SearchConsumer::class, NotificationConsumer::class, LiveConsumer::class, WebhookConsumer::class);
});

it('runs success criterion 2 over REST only', function () {
    $engine = searchEngine();
    $live = broadcasts();
    $admin = User::factory()->admin()->create(['name' => 'Erik Ende', 'handle' => 'erik']);
    $mara = User::factory()->create(['name' => 'Mara Lindqvist', 'handle' => 'mara']);
    $kira = User::factory()->bot($admin)->create(['name' => 'Kira', 'handle' => 'kira']);
    $erikToken = apiToken($admin, ['read', 'write']);
    $maraToken = apiToken($mara, ['read', 'write']);
    $kiraToken = apiToken($kira, ['read', 'write']);
    $as = function (string $token) {
        forgetApiAuth();

        return $this->withToken($token);
    };

    // (1) a workflow with a matrix that has no step from Backlog straight to Done
    $workflow = $as($erikToken)->postJson('/api/v1/workflows', [
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
    ])->assertCreated()->json('data');
    $state = collect($workflow['states'])->pluck('id', 'name');

    $project = $this->postJson('/api/v1/projects', ['name' => 'Website', 'identifier' => 'WEB', 'lead_id' => $admin->id])->assertCreated()->json('data');
    $this->postJson('/api/v1/projects/WEB/members', ['user_id' => $mara->id, 'role' => 'member'])->assertCreated();
    $this->postJson('/api/v1/projects/WEB/members', ['user_id' => $kira->id, 'role' => 'member'])->assertCreated();

    // an item in the Backlog of the standard workflow, so the change of the workflow needs a mapping
    $old = $as($maraToken)->postJson('/api/v1/work-items', ['project_id' => 'WEB', 'title' => 'Altlast'])->assertCreated()->json('data');
    $standard = $as($erikToken)->getJson("/api/v1/workflows/{$project['workflow_id']}")->assertOk()->json('data');
    $oldBacklog = collect($standard['states'])->firstWhere('name', 'Backlog')['id'];
    expect($old['state_id'])->toBe($oldBacklog);

    $refused = $this->putJson('/api/v1/projects/WEB/workflow', ['workflow_id' => $workflow['id'], 'mapping' => []])->assertUnprocessable();
    expect(array_keys($refused->json('errors')))->toBe(["mapping.{$oldBacklog}"])
        ->and($refused->json('states'))->toBe([['state_id' => $oldBacklog, 'name' => 'Backlog', 'items' => 1]]);
    $this->putJson('/api/v1/projects/WEB/workflow', ['workflow_id' => $workflow['id'], 'mapping' => [$oldBacklog => $state['Backlog']]])
        ->assertOk()->assertJsonPath('data.workflow_id', $workflow['id']);
    $this->getJson("/api/v1/work-items/{$old['key']}")->assertOk()->assertJsonPath('data.state_id', $state['Backlog']);

    // (2) a required text property, a type that asks for it, switched on in the project
    $this->postJson('/api/v1/properties', [
        'key' => 'customer', 'label' => 'Kunde', 'field_type' => 'text', 'help' => 'Für wen das Item gemacht wird.',
        'settings' => [], 'options' => [], 'default_value' => null,
    ])->assertCreated();
    $customer = $this->getJson('/api/v1/properties?filter[label]=Kunde')->assertOk()->json('data.0.id');
    $wish = $this->postJson('/api/v1/work-item-types', [
        'name' => 'Kundenwunsch', 'icon' => 'message-square-heart', 'tone' => 'plum', 'description' => 'Ein Wunsch einer Kundin.',
        'is_epic' => false, 'properties' => [['property_id' => $customer, 'required' => true]],
    ])->assertCreated()->assertJsonPath('data.properties.0.required', true)->json('data');
    $this->patchJson('/api/v1/projects/WEB', ['enabled_type_ids' => [...$project['enabled_type_ids'], $wish['id']]])
        ->assertOk()->assertJsonPath('data.enabled_type_ids', [...$project['enabled_type_ids'], $wish['id']]);

    $item = ['project_id' => 'WEB', 'type_id' => $wish['id'], 'title' => 'Kontaktformular mit Rückruf'];
    $missing = $as($maraToken)->postJson('/api/v1/work-items', $item)->assertUnprocessable();
    expect($missing->json('errors'))->toBe(['values.customer' => [__('field.values.required', ['label' => 'Kunde'])]]);
    $created = $this->postJson('/api/v1/work-items', [...$item, 'values' => ['customer' => 'Studio Nordlicht']])
        ->assertCreated()->assertJsonPath('data.values.customer', 'Studio Nordlicht')->json('data');
    $key = $created['key'];
    expect($created['state_id'])->toBe($state['Backlog']);

    // (3) the matrix holds: Backlog → Done is refused, Backlog → In Progress goes
    $this->postJson("/api/v1/work-items/{$key}/transition", ['to_state_id' => $state['Done']])->assertConflict()
        ->assertJsonPath('reason', 'transition_not_allowed');
    $this->postJson("/api/v1/work-items/{$key}/transition", ['to_state_id' => $state['In Progress']])->assertOk()
        ->assertJsonPath('data.state_id', $state['In Progress']);

    // (5, set up first) a webhook of the project for every comment event, on a receiver behind the fake DNS
    $hook = $as($erikToken)->postJson('/api/v1/webhooks', [
        'name' => 'Empfänger', 'url' => 'https://receiver.example.com/hook', 'project_id' => $project['id'],
        'events' => ['comment.*'], 'bot_id' => null, 'active' => true,
    ])->assertCreated()->assertJsonPath('data.events', ['comment.*']);
    $secret = $hook->json('secret');
    expect($secret)->toStartWith('whsec_');
    Http::assertNothingSent();

    // (4) the bot comments with @mara in Markdown: Mara's inbox has the mention, a collection with a mail opens
    $comment = $as($kiraToken)->postJson("/api/v1/work-items/{$key}/comments", ['body' => '@mara kannst du den Rückruf freigeben?'])
        ->assertCreated()->json('data');

    $mentions = $as($maraToken)->getJson('/api/v1/notifications?filter[event]=mentioned')->assertOk();
    expect($mentions->json('meta.total'))->toBe(1)
        ->and($mentions->json('data.0.event'))->toBe('mentioned')
        ->and($mentions->json('data.0.actor_id'))->toBe($kira->id)
        ->and($mentions->json('data.0.data'))->toBe(['source' => 'comment', 'comment_id' => $comment['id']])
        ->and($mentions->json('data.0.item.key'))->toBe($key)
        ->and($mentions->json('data.0.read_at'))->toBeNull();
    $told = collect($live->sent())->filter(fn (array $message) => $message['channels'] === ["presence-user.{$mara->id}"]
        && $message['payload']['type'] === 'notifications.changed');
    expect($told)->not->toBeEmpty();

    $collection = NotificationMail::query()->where('user_id', $mara->id)->sole();
    Mail::assertNothingSent();
    expect(SendNotificationMail::run(Actor::system(User::defaultBot(), 'notification_mail'), $collection->id))->toBe(NotificationMail::SENT);
    Mail::assertSent(NotificationDigest::class, fn (NotificationDigest $mail) => $mail->hasTo($mara->email));

    // (5) the comment of (4) went to the receiver, once, signed with the secret of the answer of POST /webhooks
    $delivery = WebhookDelivery::query()->where('webhook_id', $hook->json('data.id'))->sole();
    expect($delivery->event)->toBe('comment.created')
        ->and($delivery->status)->toBe(WebhookDelivery::SUCCEEDED);
    Http::assertSentCount(1);
    /** @var Request $sent */
    $sent = Http::recorded()->sole()[0];
    $payload = json_decode($sent->body(), true);
    expect($sent->url())->toBe('https://receiver.example.com/hook')
        ->and($sent->header('X-Werkbuch-Event'))->toBe(['comment.created'])
        ->and($sent->header('X-Werkbuch-Delivery'))->toBe([$delivery->id])
        ->and($payload['data']['id'])->toBe($comment['id'])
        ->and($payload['data']['work_item']['key'])->toBe($key)
        ->and(Signature::verify($secret, (int) $sent->header('X-Werkbuch-Timestamp')[0], $sent->body(), $sent->header('X-Werkbuch-Signature')[0], time()))->toBeTrue()
        ->and(Signature::verify("{$secret}x", (int) $sent->header('X-Werkbuch-Timestamp')[0], $sent->body(), $sent->header('X-Werkbuch-Signature')[0], time()))->toBeFalse();

    // (6) the search finds the item by a word of its title, and the key jumps to it
    $byWord = $as($maraToken)->getJson('/api/v1/search?q=Rückruf&types=items')->assertOk();
    expect($byWord->json('data.items.*.id'))->toBe([$created['id']])
        ->and($byWord->json('data.key_match'))->toBeNull();
    $byKey = $this->getJson("/api/v1/search?q={$key}&types=items")->assertOk();
    expect($byKey->json('data.key_match'))->toBe($created['id'])
        ->and($byKey->json('data.items.0.id'))->toBe($created['id'])
        ->and($engine->documents('testing_work_items'))->toHaveCount(2);

    // every answer of the run kept the document
    expect(Contract::violations())->toBe([])
        ->and(Contract::recorded())->toContain('POST /work-items 422', 'POST /work-items/{item}/transition 409', 'GET /notifications 200', 'GET /search 200');
});

it('answers every list with the same envelope', function () {
    $w = MatrixWorld::build();
    $token = apiToken($w->account('org_admin'), ['read']);
    $rows = collect(require __DIR__.'/routes.php');

    $lists = collect(Route::getRoutes()->getRoutes())
        ->filter(fn (RoutingRoute $route) => str_starts_with($route->uri(), 'api/v1/') && in_array('GET', $route->methods(), true))
        ->filter(function (RoutingRoute $route) {
            [$controller, $method] = explode('@', $route->getActionName()) + [1 => '__invoke'];

            return (new ReflectionMethod($controller, $method))->getAttributes(ListOf::class) !== [];
        })
        ->map(fn (RoutingRoute $route) => '/'.$route->uri())
        ->values();
    // 24 since GET /work-items/{item}/pages (Task 21u)
    expect($lists)->toHaveCount(24);

    foreach ($lists as $uri) {
        $row = $rows->first(fn (array $row) => $row[0] === 'GET' && $row[1] === $uri);
        $path = strtr($uri, collect(isset($row['params']) ? ($row['params'])($w) : [])->mapWithKeys(fn (string $value, string $key) => ["{{$key}}" => $value])->all());
        forgetApiAuth();
        $response = $this->withToken($token)->getJson($path);
        $context = "GET {$path}: {$response->getContent()}";

        expect($response->getStatusCode())->toBe(200, $context)
            ->and(array_keys($response->json()))->toBe(['data', 'links', 'meta'], $context)
            ->and(array_is_list($response->json('data')))->toBeTrue($context)
            ->and(array_keys($response->json('links')))->toBe(['first', 'last', 'prev', 'next'], $context)
            ->and(array_keys($response->json('meta')))->toBe(['path', 'per_page', 'next_cursor', 'prev_cursor', 'total'], $context)
            ->and($response->json('meta.total'))->toBeInt($context)
            ->and($response->json('meta.per_page'))->toBe(100, $context);
    }
});
