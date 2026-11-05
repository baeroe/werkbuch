<?php

use App\Domain\Webhooks\Signature;
use App\Jobs\DeliverWebhook;
use App\Models\Webhook;
use App\Models\WebhookAttempt;
use App\Models\WebhookDelivery;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Tests\Support\WebhookReceiver;

/*
 * A delivery over a real connection (task 7, K4, K5): a receiver in the process of the test (PHP's built-in server on
 * 127.0.0.1); `receiver.test` is a name no DNS knows, so a request can only arrive at the address SafeTarget checked and
 * pinned. The queue as in production (`database`), one worker run per try.
 */

beforeEach(function () {
    config(['queue.default' => 'database', 'werkbuch.webhooks_allow_private' => true]);
    resolver(['receiver.test' => ['127.0.0.1']]);
    $this->receiver = WebhookReceiver::start();
});

afterEach(fn () => $this->receiver->stop());

$deliver = function (WebhookReceiver $receiver, string $path): WebhookDelivery {
    $webhook = Webhook::factory()->create(['url' => "http://RECEIVER.test:{$receiver->port}{$path}?token=t0k3n"]);
    $delivery = WebhookDelivery::factory()->for($webhook)->create(['body' => '{"id":"01kevent","title":"Formular prüfen"}']);
    DeliverWebhook::enqueue($delivery);
    Artisan::call('queue:work', ['--once' => true, '--queue' => 'webhooks', '--sleep' => 0]);

    return $delivery;
};

it('delivers a signed request to the pinned address of the name', function () use ($deliver) {
    $delivery = $deliver($this->receiver, '/ok');

    [$request] = $this->receiver->requests();
    $headers = $request['headers'];
    $attempt = WebhookAttempt::query()->sole();
    expect($request['body'])->toBe($delivery->body)
        ->and($headers['host'])->toBe("receiver.test:{$this->receiver->port}")
        ->and($headers['x-werkbuch-delivery'])->toBe($delivery->id)
        ->and(Signature::verify(Webhook::query()->sole()->secret, (int) $headers['x-werkbuch-timestamp'], $request['body'], $headers['x-werkbuch-signature'], now()->timestamp))->toBeTrue()
        ->and($attempt->only(['status_code', 'response_excerpt', 'error']))->toBe(['status_code' => 200, 'response_excerpt' => 'ok', 'error' => null])
        // the time curl measured
        ->and($attempt->duration_ms)->toBeGreaterThanOrEqual(0)
        ->and($delivery->fresh()->status)->toBe(WebhookDelivery::SUCCEEDED);
});

it('ignores the proxy variables of the environment (K4)', function () use ($deliver) {
    // a proxy that does not exist: a request through it would fail
    foreach (['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy'] as $name) {
        putenv("{$name}=http://127.0.0.1:9");
    }

    try {
        $delivery = $deliver($this->receiver, '/ok');
    } finally {
        foreach (['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy'] as $name) {
            putenv($name);
        }
    }

    expect($this->receiver->requests())->toHaveCount(1)
        ->and($delivery->fresh()->status)->toBe(WebhookDelivery::SUCCEEDED);
});

it('does not follow a redirect', function () use ($deliver) {
    $delivery = $deliver($this->receiver, '/redirect');

    expect(array_column($this->receiver->requests(), 'path'))->toBe(['/redirect'])
        ->and(WebhookAttempt::query()->sole()->status_code)->toBe(302)
        ->and($delivery->fresh()->status)->toBe(WebhookDelivery::PENDING);
});

it('stops reading a large answer and counts it a failure (K4)', function () use ($deliver) {
    $deliver($this->receiver, '/big');

    $attempt = WebhookAttempt::query()->sole();
    expect($attempt->status_code)->toBeNull()
        ->and($attempt->error)->toBe('too_large: Webhook answer too large')
        ->and(DB::table('jobs')->where('queue', 'webhooks')->count())->toBe(1);
});

it('records a refused connection with the URL masked', function () use ($deliver) {
    $this->receiver->stop();

    $deliver($this->receiver, '/ok');

    $error = (string) WebhookAttempt::query()->sole()->error;
    expect($error)->toStartWith('connection: cURL error 7:')
        ->and($error)->not->toContain('t0k3n');
});
