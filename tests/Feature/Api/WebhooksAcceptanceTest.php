<?php

use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Events\EventType;
use App\Events\Outbox;
use App\Models\Project;
use App\Models\User;
use App\Models\WebhookDelivery;
use App\Models\WorkItem;
use App\Webhooks\WebhookConsumer;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Http;

/*
 * The acceptance of phase 11 over REST (success criterion 2.5 and the agent scenario of spec 6.3): a token of an org admin
 * sets up a webhook for the bot Kira and `bot.*`; what a member does with Kira reaches the receiver signed, once, in the
 * form the docs describe, and the signature checks out with the PHP snippet of the docs (A374). The queue runs as outside
 * the tests (`database`, one worker run over `default` and `webhooks`); the receiver is Http::fake behind a fake DNS.
 */

beforeEach(function () {
    config(['queue.default' => 'database']);
    consumers(WebhookConsumer::class);
    resolver(['hooks.example.com' => ['93.184.216.34']]);
    Http::fake(['https://hooks.example.com/*' => Http::response('thanks')]);
    require_once repo_path('docs/snippets/webhooks/verify.php');
});

/**
 * WEB (private) with Mara as org admin and project admin, Lene as member and the bot Kira as member, an item WEB-1; OPS
 * (public) with Mara.
 *
 * @return array{mara: User, lene: User, kira: User, web: Project, ops: Project, item: WorkItem}
 */
$world = function (): array {
    $mara = User::factory()->admin()->create(['name' => 'Mara', 'handle' => 'mara']);
    $web = Project::factory()->identifier('WEB')->private()->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $ops = Project::factory()->identifier('OPS')->public()->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $lene = memberOf($web, ProjectRole::Member, ['name' => 'Lene', 'handle' => 'lene']);
    $kira = User::factory()->bot($mara)->create(['name' => 'Kira', 'handle' => 'kira']);
    app(RoleAssignments::class)->setProjectRole($kira, $web, ProjectRole::Member);

    return [...compact('mara', 'lene', 'kira', 'web', 'ops'), 'item' => WorkItem::factory()->for($web)->create(['title' => 'Kontaktformular prüfen'])];
};

/**
 * The worker, as it runs outside the tests: events to the consumer, the consumer to its deliveries, until nothing is due.
 * Without `--memory` it would stop after its first job in a full run ("Memory limit exceeded": the test process holds more
 * than the 128 MB of the default).
 */
$work = fn () => Artisan::call('queue:work', ['--stop-when-empty' => true, '--queue' => 'default,webhooks', '--sleep' => 0, '--memory' => 4096]);

/** What the receiver got, in order. */
$received = fn (): array => Http::recorded()->map(fn (array $pair) => $pair[0])->values()->all();

it('takes the bot Kira through assignment and mention, signed and once, and lets go when Kira leaves', function () use ($world, $work, $received) {
    $w = $world();
    $mara = apiToken($w['mara'], ['read', 'write']);
    $lene = apiToken($w['lene'], ['read', 'write']);

    // an org admin sets up the agent's webhook: Kira, every bot event; and a webhook of another project
    $created = $this->withToken($mara)->postJson('/api/v1/webhooks', [
        'name' => 'Agent Kira', 'url' => 'https://hooks.example.com/agent', 'events' => ['bot.*'], 'bot_id' => $w['kira']->id, 'project_id' => null, 'active' => true,
    ])->assertCreated()->assertJsonPath('data.events', ['bot.*'])->assertJsonPath('data.bot_id', $w['kira']->id);
    $secret = $created->json('secret');
    $agent = $created->json('data.id');
    $other = $this->postJson('/api/v1/webhooks', [
        'name' => 'OPS', 'url' => 'https://hooks.example.com/ops', 'events' => ['bot.*', 'work_item.*', 'comment.*'], 'bot_id' => null, 'project_id' => $w['ops']->id, 'active' => true,
    ])->assertCreated()->json('data.id');
    $work();
    expect($received())->toBe([]);

    // a member gives Kira the item: one delivery bot.assigned
    forgetApiAuth();
    $this->withToken($lene)->patchJson('/api/v1/work-items/WEB-1', ['assignee_id' => $w['kira']->id])->assertOk();
    $work();

    $requests = $received();
    expect($requests)->toHaveCount(1);
    $request = $requests[0];
    $body = $request->body();
    $payload = json_decode($body, true);
    $assigned = eventsOf(EventType::BotAssigned, $w['item'])->sole();
    expect($request->url())->toBe('https://hooks.example.com/agent')
        ->and($request->header('X-Werkbuch-Event'))->toBe(['bot.assigned'])
        ->and($request->header('X-Werkbuch-Delivery'))->toBe([WebhookDelivery::query()->where('webhook_id', $agent)->sole()->id])
        ->and(array_keys($payload))->toBe(['id', 'event', 'occurred_at', 'actor', 'project', 'data', 'changes'])
        ->and($payload['id'])->toBe($assigned->id)
        ->and($payload['event'])->toBe('bot.assigned')
        ->and($payload['actor'])->toBe(['id' => $w['lene']->id, 'type' => 'person', 'name' => 'Lene', 'handle' => 'lene'])
        ->and($payload['project'])->toBe(['id' => $w['web']->id, 'identifier' => 'WEB'])
        ->and($payload['data']['item']['key'])->toBe('WEB-1')
        ->and($payload['data']['item']['assignee_id'])->toBe($w['kira']->id)
        ->and($payload['data']['bot']['handle'])->toBe('kira')
        // nothing of meta leaves (A282, A342, A357)
        ->and($body)->not->toContain('"meta"')
        ->and($body)->not->toContain('"socket"');

    // the receiver checks the signature with the snippet of the docs
    $timestamp = $request->header('X-Werkbuch-Timestamp')[0];
    $signature = $request->header('X-Werkbuch-Signature')[0];
    expect(verifyWerkbuchSignature($secret, $timestamp, $body, $signature))->toBeTrue()
        ->and(verifyWerkbuchSignature("{$secret}x", $timestamp, $body, $signature))->toBeFalse()
        ->and(verifyWerkbuchSignature($secret, $timestamp, str_replace('WEB-1', 'WEB-2', $body), $signature))->toBeFalse()
        ->and(verifyWerkbuchSignature($secret, $timestamp, $body, $signature, (int) $timestamp + 301))->toBeFalse();

    // distributed twice more (the redispatcher, a second dispatch): still one delivery, nothing sent again
    app(Outbox::class)->dispatch($assigned->id);
    app(Outbox::class)->dispatch($assigned->id);
    $work();
    expect($received())->toHaveCount(1)
        ->and(WebhookDelivery::query()->where('event_id', $assigned->id)->count())->toBe(1);

    // a comment of the member with @kira: bot.mentioned with the comment
    forgetApiAuth();
    $this->withToken($lene)->postJson('/api/v1/work-items/WEB-1/comments', ['body' => '@kira übernimmst du die Prüfung?'])->assertCreated();
    $work();

    $requests = $received();
    expect($requests)->toHaveCount(2);
    $mentioned = json_decode($requests[1]->body(), true);
    expect($requests[1]->header('X-Werkbuch-Event'))->toBe(['bot.mentioned'])
        ->and($mentioned['event'])->toBe('bot.mentioned')
        ->and($mentioned['data']['source'])->toBe('comment')
        ->and($mentioned['data']['item']['key'])->toBe('WEB-1')
        ->and($mentioned['data']['comment']['body'])->toBe('@kira übernimmst du die Prüfung?')
        ->and($mentioned['data']['comment']['author_id'])->toBe($w['lene']->id)
        ->and(verifyWerkbuchSignature($secret, $requests[1]->header('X-Werkbuch-Timestamp')[0], $requests[1]->body(), $requests[1]->header('X-Werkbuch-Signature')[0]))->toBeTrue();

    // a mention made while Kira is still a member, consumed after the admin took Kira out of the private project: the
    // consumer asks when it consumes, so the next event reaches nobody
    $this->postJson('/api/v1/work-items/WEB-1/comments', ['body' => '@kira und der Footer?'])->assertCreated();
    expect(eventsOf(EventType::BotMentioned, $w['item']))->toHaveCount(2);
    forgetApiAuth();
    $this->withToken($mara)->deleteJson("/api/v1/projects/WEB/members/{$w['kira']->id}")->assertNoContent();
    $work();

    expect($received())->toHaveCount(2)
        ->and(WebhookDelivery::query()->where('webhook_id', $agent)->count())->toBe(2)
        // the webhook of OPS got nothing of WEB
        ->and(WebhookDelivery::query()->where('webhook_id', $other)->count())->toBe(0)
        ->and(collect($received())->filter(fn (Request $sent) => $sent->url() === 'https://hooks.example.com/ops'))->toBeEmpty();
});
