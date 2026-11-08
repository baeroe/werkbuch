<?php

use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Actions\Webhooks\RecordWebhookAttempt;
use App\Actions\Webhooks\RotateWebhookSecret;
use App\Actions\WorkItems\CreateWorkItem;
use App\Domain\Webhooks\Backoff;
use App\Domain\Webhooks\Signature;
use App\Events\EventType;
use App\Jobs\DeliverWebhook;
use App\Models\Project;
use App\Models\User;
use App\Models\Webhook;
use App\Models\WebhookAttempt;
use App\Models\WebhookDelivery;
use App\Webhooks\PinnedAddressNotUsed;
use App\Webhooks\ResponseTooLarge;
use App\Webhooks\SafeTarget;
use GuzzleHttp\Psr7\Request as PsrRequest;
use GuzzleHttp\Psr7\Response as PsrResponse;
use GuzzleHttp\TransferStats;
use Illuminate\Http\Client\Request;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event as Events;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;

/*
 * Delivering a webhook (task 7, spec 6.3, K1, K2, K4–K7): the job of a delivery reads webhook, URL, secret and body
 * afresh on every try, checks the target after DNS, signs each try with its own timestamp, logs one attempt per call
 * and retries on the schedule of Backoff. The queue as outside the tests (`database`), one worker run per try.
 */

beforeEach(function () {
    // a stopped clock: timestamps and `available_at` compare to the second
    $this->freezeSecond();
    config(['queue.default' => 'database']);
    resolver(['receiver.example.com' => ['93.184.216.34']]);
});

/** A pending delivery of a new webhook, queued as the consumer queues it. */
$deliver = function (array $webhook = [], string $body = '{"id":"01kevent","event":"work_item.created"}'): WebhookDelivery {
    $hook = Webhook::factory()->create(['url' => 'https://receiver.example.com/hook', ...$webhook]);
    $delivery = WebhookDelivery::factory()->for($hook)->create(['body' => $body]);
    DeliverWebhook::enqueue($delivery);

    return $delivery;
};

/** One run of a worker on the queue `webhooks`: the try that is due. */
$work = fn () => Artisan::call('queue:work', ['--once' => true, '--queue' => 'webhooks', '--sleep' => 0]);

$jobs = fn () => DB::table('jobs')->where('queue', 'webhooks')->get();

/** The requests the fake receiver got, in order. */
$sent = fn (): array => Http::recorded()->map(fn (array $pair) => $pair[0])->all();

$attempts = fn (WebhookDelivery $delivery) => WebhookAttempt::query()->where('delivery_id', $delivery->id)->orderBy('attempt')->get();

it('signs timestamp and body the way the docs verify it', function () use ($deliver, $work, $sent) {
    Http::fake(['*' => Http::response('ok')]);
    $delivery = $deliver();

    $work();

    [$request] = $sent();
    $secret = Webhook::query()->sole()->secret;
    $timestamp = (int) $request->header('X-Werkbuch-Timestamp')[0];
    expect($request->url())->toBe('https://receiver.example.com/hook')
        ->and($request->method())->toBe('POST')
        ->and($request->body())->toBe($delivery->body)
        ->and($timestamp)->toBe(now()->timestamp)
        ->and(Signature::verify($secret, $timestamp, $request->body(), $request->header('X-Werkbuch-Signature')[0], now()->timestamp))->toBeTrue()
        ->and(Signature::verify('whsec_other', $timestamp, $request->body(), $request->header('X-Werkbuch-Signature')[0], now()->timestamp))->toBeFalse();
});

it('sends the four werkbuch headers and no spatie header', function () use ($deliver, $work, $sent) {
    Http::fake(['*' => Http::response('ok')]);
    $delivery = $deliver();

    $work();

    [$request] = $sent();
    expect($request->header('X-Werkbuch-Event'))->toBe(['work_item.created'])
        ->and($request->header('X-Werkbuch-Delivery'))->toBe([$delivery->id])
        ->and($request->hasHeader('X-Werkbuch-Timestamp'))->toBeTrue()
        ->and($request->header('X-Werkbuch-Signature')[0])->toStartWith('sha256=')
        ->and($request->header('Content-Type'))->toBe(['application/json'])
        ->and($request->header('User-Agent'))->toBe(['werkbuch/'.config('werkbuch.version')])
        ->and($request->hasHeader('Signature'))->toBeFalse()
        ->and($request->hasHeader('Timestamp'))->toBeFalse()
        ->and($request->hasHeader('Webhook-Id'))->toBeFalse();
});

it('records one attempt per call and the delivery as succeeded (K2)', function () use ($deliver, $work, $jobs, $attempts) {
    Http::fake(['*' => Http::response('thanks', 200)]);
    $delivery = $deliver();

    $work();

    $attempt = $attempts($delivery)->sole();
    $webhook = Webhook::query()->sole();
    expect($attempt->only(['attempt', 'kind', 'status_code', 'response_excerpt', 'error', 'webhook_id']))
        ->toBe(['attempt' => 1, 'kind' => WebhookAttempt::SCHEDULED, 'status_code' => 200, 'response_excerpt' => 'thanks', 'error' => null, 'webhook_id' => $webhook->id])
        // under Http::fake there are no transfer stats: the time of the call
        ->and($attempt->duration_ms)->toBeGreaterThanOrEqual(0)
        ->and($delivery->fresh()->only(['status', 'attempts']))->toBe(['status' => WebhookDelivery::SUCCEEDED, 'attempts' => 1])
        ->and($webhook->last_success_at?->timestamp)->toBe(now()->timestamp)
        ->and($webhook->failing_since)->toBeNull()
        ->and($jobs())->toHaveCount(0);
});

it('sends the same body and delivery id on every attempt with a new timestamp', function () use ($deliver, $work, $sent) {
    Http::fake(['*' => Http::sequence()->push('down', 500)->push('ok', 200)]);
    $delivery = $deliver();

    $work();
    $this->travel(61)->seconds();
    $work();

    [$first, $second] = $sent();
    expect($second->body())->toBe($first->body())->toBe($delivery->body)
        ->and($second->header('X-Werkbuch-Delivery'))->toBe($first->header('X-Werkbuch-Delivery'))->toBe([$delivery->id])
        ->and((int) $second->header('X-Werkbuch-Timestamp')[0] - (int) $first->header('X-Werkbuch-Timestamp')[0])->toBe(61)
        ->and($second->header('X-Werkbuch-Signature'))->not->toBe($first->header('X-Werkbuch-Signature'));
});

it('retries on 500 after one minute, then five', function () use ($deliver, $work, $jobs, $attempts) {
    Http::fake(['*' => Http::response('down', 500)]);
    $delivery = $deliver();

    $work();
    $job = $jobs()->sole();
    expect($job->available_at)->toBe(now()->timestamp + 60)
        ->and($job->attempts)->toBe(1)
        ->and($attempts($delivery)->pluck('status_code')->all())->toBe([500])
        ->and($delivery->fresh()->only(['status', 'attempts']))->toBe(['status' => WebhookDelivery::PENDING, 'attempts' => 1]);

    // not due yet: nothing is sent
    $work();
    Http::assertSentCount(1);

    $this->travel(60)->seconds();
    $work();
    expect($jobs()->sole()->available_at)->toBe(now()->timestamp + 300)
        ->and($attempts($delivery)->pluck('attempt')->all())->toBe([1, 2])
        ->and(Webhook::query()->sole()->failing_since?->timestamp)->toBe(now()->subSeconds(60)->timestamp);
});

it('stops after eight attempts and marks the delivery failed', function () use ($deliver, $work, $jobs, $attempts) {
    Http::fake(['*' => Http::response('down', 503)]);
    $delivery = $deliver();

    foreach (range(1, Backoff::TRIES) as $try) {
        $work();
        $next = $jobs()->first();
        if ($next !== null) {
            $this->travelTo(now()->setTimestamp($next->available_at));
        }
    }

    Http::assertSentCount(8);
    expect($attempts($delivery)->pluck('attempt')->all())->toBe(range(1, 8))
        ->and($delivery->fresh()->only(['status', 'attempts']))->toBe(['status' => WebhookDelivery::FAILED, 'attempts' => 8])
        ->and($jobs())->toHaveCount(0)
        ->and(DB::table('failed_jobs')->count())->toBe(0);
});

it('counts a 302 as a failure and does not follow it', function () use ($deliver, $work, $jobs, $attempts) {
    Http::fake(['*' => Http::response('', 302, ['Location' => 'http://169.254.169.254/latest/meta-data/'])]);
    $delivery = $deliver();

    $work();

    Http::assertSentCount(1);
    expect($attempts($delivery)->sole()->only(['status_code', 'error']))->toBe(['status_code' => 302, 'error' => null])
        ->and($delivery->fresh()->status)->toBe(WebhookDelivery::PENDING)
        ->and($jobs())->toHaveCount(1);
});

it('records a timeout without a status, its URL masked', function () use ($deliver, $work, $attempts) {
    Http::fake(['*' => Http::failedConnection('cURL error 28: Operation timed out after 10001 milliseconds with 0 bytes received (see https://curl.haxx.se/libcurl/c/libcurl-errors.html) for https://receiver.example.com/hook?token=geheim')]);
    $delivery = $deliver(['url' => 'https://receiver.example.com/hook?token=geheim']);

    $work();

    $attempt = $attempts($delivery)->sole();
    expect($attempt->status_code)->toBeNull()
        ->and($attempt->response_excerpt)->toBeNull()
        ->and($attempt->error)->toBe('timeout: cURL error 28: Operation timed out after 10001 milliseconds with 0 bytes received (see https://curl.haxx.se/libcurl/c/libcurl-errors.html) for https://receiver.example.com/hook?…');
});

it('records a failed connection as connection', function () use ($deliver, $work, $attempts) {
    Http::fake(['*' => Http::failedConnection()]);
    $delivery = $deliver();

    $work();

    expect($attempts($delivery)->sole()->error)->toStartWith('connection: cURL error 6: Could not resolve host: receiver.example.com');
});

it('cuts the answer to 2 KB without breaking a character', function () use ($deliver, $work, $attempts) {
    Http::fake(['*' => Http::response('a'.str_repeat('ä', 3000), 500)]);
    $delivery = $deliver();

    $work();

    $excerpt = (string) $attempts($delivery)->sole()->response_excerpt;
    expect(strlen($excerpt))->toBe(2047)
        ->and(mb_check_encoding($excerpt, 'UTF-8'))->toBeTrue();
});

it('logs a packed answer as its encoding and size, not as its bytes (T8-M1)', function () use ($deliver, $work, $attempts) {
    $packed = (string) gzencode(str_repeat('{"ok":true}', 500));
    Http::fake(['*' => Http::response($packed, 200, ['Content-Encoding' => 'gzip'])]);
    $delivery = $deliver();

    $work();

    expect($attempts($delivery)->sole()->response_excerpt)->toBe('(gzip, '.strlen($packed).' bytes)');
});

it('never logs or stores the secret', function () use ($deliver, $work, $jobs) {
    $logged = [];
    Events::listen(MessageLogged::class, function (MessageLogged $message) use (&$logged) {
        $logged[] = $message->message.json_encode($message->context);
    });
    Http::fake(['*' => Http::sequence()->push('down', 500)->pushFailedConnection()->push('ok', 200)]);
    $delivery = $deliver();
    $secret = Webhook::query()->sole()->secret;

    $work();
    expect($jobs())->toHaveCount(1);
    $this->travel(61)->seconds();
    $work();
    $this->travel(301)->seconds();
    // the log failing once is reported (K2): still no secret in the report
    app()->bind(RecordWebhookAttempt::class, fn () => throw new RuntimeException('Deadlock found when trying to get lock'));
    $work();

    $everything = collect(Schema::getTableListing(DB::getDatabaseName(), schemaQualified: false))
        ->map(fn (string $table) => json_encode(DB::table($table)->get(), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES))
        ->implode("\n");
    Http::assertSentCount(3);
    expect($everything)->not->toContain($secret)
        ->and($everything)->toContain($delivery->id)
        ->and(implode("\n", $logged))->not->toContain($secret)
        ->and($logged)->not->toBe([]);
});

it('keeps body, URL and secret out of the job (K7, T6-M4)', function () use ($deliver, $jobs) {
    Http::fake();
    $deliver(['url' => 'https://receiver.example.com/hook?token=t0k3n'], '{"title":"Marker-4711"}');
    $payload = $jobs()->sole()->payload;
    $secret = Webhook::query()->sole()->secret;

    // spatie writes the strings of the job base64-encoded: look at the job as the worker reads it
    $job = unserialize((string) json_decode($payload, true)['data']['command']);
    expect($job)->toBeInstanceOf(DeliverWebhook::class)
        ->and($job->webhookUrl)->toBe(DeliverWebhook::PLACEHOLDER_URL)
        ->and($job->getBody())->toBe('')
        ->and($job->meta)->toBe(['delivery_id' => WebhookDelivery::query()->sole()->id, 'kind' => 'scheduled'])
        ->and(var_export($job, true))->not->toContain('Marker-4711')->not->toContain('t0k3n')->not->toContain($secret)
        ->and($payload)->not->toContain('Marker-4711')->not->toContain('t0k3n')->not->toContain($secret);
});

it('reads the URL afresh on every try', function () use ($deliver, $work, $sent) {
    resolver(['receiver.example.com' => ['93.184.216.34'], 'new.example.com' => ['93.184.216.35']]);
    Http::fake(['*' => Http::response('down', 500)]);
    $deliver();

    $work();
    Webhook::query()->sole()->update(['url' => 'https://new.example.com/hook']);
    $this->travel(61)->seconds();
    $work();

    expect(array_map(fn (Request $request) => $request->url(), $sent()))->toBe(['https://receiver.example.com/hook', 'https://new.example.com/hook']);
});

it('never sends again because the log failed (K2)', function () use ($deliver, $work, $jobs) {
    Http::fake(['*' => Http::response('ok')]);
    $delivery = $deliver();
    app()->bind(RecordWebhookAttempt::class, fn () => throw new RuntimeException('Lock wait timeout exceeded'));

    $work();

    Http::assertSentCount(1);
    // the log is lost, the delivery stays pending (pruning finishes it, K15), and no try follows
    expect($jobs())->toHaveCount(0)
        ->and(DB::table('failed_jobs')->count())->toBe(0)
        ->and($delivery->fresh()->status)->toBe(WebhookDelivery::PENDING);
});

it('does not send to a name that now points at 127.0.0.1', function () use ($deliver, $work, $attempts, $jobs) {
    Http::fake();
    $delivery = $deliver();
    resolver(['receiver.example.com' => ['93.184.216.34', '127.0.0.1']]);

    $work();

    Http::assertNothingSent();
    $attempt = $attempts($delivery)->sole();
    expect($attempt->status_code)->toBeNull()
        ->and($attempt->error)->toBe('private_address: Webhook target receiver.example.com refused: private_address')
        // a refused target is a failure like any other: the schedule goes on
        ->and($jobs())->toHaveCount(1)
        ->and(Webhook::query()->sole()->failing_since)->not->toBeNull();
});

it('records a name without any address as unresolvable', function () use ($deliver, $work, $attempts) {
    Http::fake();
    $delivery = $deliver();
    resolver([]);

    $work();

    Http::assertNothingSent();
    expect($attempts($delivery)->sole()->error)->toStartWith('unresolvable: ');
});

it('cancels when the webhook was switched off, deleted or the bot lost access', function () use ($deliver, $work, $jobs) {
    Http::fake();

    // switched off by an admin, and by the system
    $off = $deliver();
    Webhook::query()->whereKey($off->webhook_id)->update(['active' => false]);
    $work();
    $disabled = $deliver();
    Webhook::query()->whereKey($disabled->webhook_id)->update(['disabled_at' => now()]);
    $work();

    // deleted: its deliveries go with it, the job finds nothing
    $deleted = $deliver();
    Webhook::query()->whereKey($deleted->webhook_id)->delete();
    $work();

    // the bot of the webhook left the private project of the event, and a deactivated bot
    $mara = User::factory()->admin()->create();
    $web = Project::factory()->private()->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $kira = User::factory()->bot($mara)->create();
    $otto = User::factory()->bot($mara)->create();
    app(RoleAssignments::class)->setProjectRole($kira, $web, ProjectRole::Member);
    app(RoleAssignments::class)->setProjectRole($otto, $web, ProjectRole::Member);
    $item = CreateWorkItem::run(actor($mara), ['project_id' => $web->id, 'title' => 'Formular prüfen']);
    $event = eventsOf(EventType::WorkItemCreated, $item)->sole();
    $left = $deliver(['bot_id' => $kira->id]);
    $left->update(['event_id' => $event->id]);
    $gone = $deliver(['bot_id' => $otto->id]);
    $gone->update(['event_id' => $event->id]);
    app(RoleAssignments::class)->removeFromProject($kira, $web);
    $otto->update(['disabled_at' => now()]);
    $work();
    $work();

    Http::assertNothingSent();
    expect($off->fresh()->status)->toBe(WebhookDelivery::CANCELLED)
        ->and($disabled->fresh()->status)->toBe(WebhookDelivery::CANCELLED)
        ->and($deleted->fresh())->toBeNull()
        ->and($left->fresh()->status)->toBe(WebhookDelivery::CANCELLED)
        ->and($gone->fresh()->status)->toBe(WebhookDelivery::CANCELLED)
        ->and(WebhookAttempt::query()->count())->toBe(0)
        ->and($jobs())->toHaveCount(0);
});

it('sends to a bot webhook while the bot still sees the project', function () use ($deliver, $work) {
    Http::fake(['*' => Http::response('ok')]);
    $mara = User::factory()->admin()->create();
    $web = Project::factory()->private()->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $kira = User::factory()->bot($mara)->create();
    app(RoleAssignments::class)->setProjectRole($kira, $web, ProjectRole::Member);
    $item = CreateWorkItem::run(actor($mara), ['project_id' => $web->id, 'title' => 'Formular prüfen']);
    $delivery = $deliver(['bot_id' => $kira->id]);
    $delivery->update(['event_id' => eventsOf(EventType::WorkItemCreated, $item)->sole()->id]);

    $work();

    Http::assertSentCount(1);
    expect($delivery->fresh()->status)->toBe(WebhookDelivery::SUCCEEDED);
});

it('finds nothing to do for a delivery that is no longer pending', function () use ($deliver, $work, $jobs) {
    Http::fake();
    $delivery = $deliver();
    $delivery->update(['status' => WebhookDelivery::SUCCEEDED]);

    $work();

    Http::assertNothingSent();
    expect($jobs())->toHaveCount(0)
        ->and(WebhookAttempt::query()->count())->toBe(0);
});

it('uses a secret rotated between two attempts', function () use ($deliver, $work, $sent) {
    Http::fake(['*' => Http::response('down', 500)]);
    $deliver();
    $old = Webhook::query()->sole()->secret;

    $work();
    $rotated = RotateWebhookSecret::run(actor(User::factory()->admin()->create()), Webhook::query()->sole());
    $this->travel(61)->seconds();
    $work();

    [$first, $second] = $sent();
    $verify = fn (Request $request, string $secret) => Signature::verify($secret, (int) $request->header('X-Werkbuch-Timestamp')[0], $request->body(), $request->header('X-Werkbuch-Signature')[0], (int) $request->header('X-Werkbuch-Timestamp')[0]);
    expect($verify($first, $old))->toBeTrue()
        ->and($verify($second, $rotated['secret']))->toBeTrue()
        ->and($verify($second, $old))->toBeFalse();
});

it('asks for no redirect, no proxy, a short connect, a pinned address and a limited answer (K4, K5)', function () {
    putenv('HTTPS_PROXY=http://proxy.example.com:3128');
    putenv('HTTP_PROXY=http://proxy.example.com:3128');

    try {
        $job = new DeliverWebhook;
        $options = (function () {
            $this->verifySsl = true;
            $this->target = SafeTarget::check('https://receiver.example.com/hook');

            return $this->requestOptions();
        })->call($job);

        expect($options['allow_redirects'])->toBeFalse()
            ->and($options['connect_timeout'])->toBe(5)
            ->and($options['proxy'])->toBe('')
            ->and($options['curl'])->toBe([CURLOPT_RESOLVE => ['receiver.example.com:443:93.184.216.34']])
            ->and($options['verify'])->toBeTrue()
            ->and(fn () => $options['progress'](0, DeliverWebhook::RESPONSE_MAX))->not->toThrow(ResponseTooLarge::class)
            ->and(fn () => $options['progress'](0, DeliverWebhook::RESPONSE_MAX + 1))->toThrow(ResponseTooLarge::class);
    } finally {
        putenv('HTTPS_PROXY');
        putenv('HTTP_PROXY');
    }
});

it('pins nothing for an address literal', function () {
    $options = (function () {
        $this->verifySsl = true;
        $this->target = SafeTarget::check('https://93.184.216.34/hook');

        return $this->requestOptions();
    })->call(new DeliverWebhook);

    expect($options['curl'])->toBe([]);
});

it('refuses an answer from an address it did not check (K5)', function () {
    $stats = fn (string $ip) => new TransferStats(new PsrRequest('POST', 'https://receiver.example.com/hook'), new PsrResponse(200), 0.25, null, ['primary_ip' => $ip]);
    $job = new DeliverWebhook;
    $onStats = (function () {
        $this->verifySsl = true;
        $this->target = SafeTarget::check('https://receiver.example.com/hook');

        return $this->requestOptions()['on_stats'];
    })->call($job);

    $onStats($stats('93.184.216.34'));
    $onStats($stats(''));

    expect(fn () => $onStats($stats('10.0.0.7')))->toThrow(PinnedAddressNotUsed::class, 'pinned address not used');
});

it('pauses as the back-off after a try that threw before it sent (T7-M5)', function () {
    // an exception out of PrepareWebhookAttempt (the database, a secret it cannot decrypt) leaves the job to the worker,
    // which waits as backoff() says instead of using up the eight tries at once
    expect((new DeliverWebhook)->backoff())->toBe(array_map(fn (int $attempt) => Backoff::delayAfter($attempt), range(1, 7)));
});
