<?php

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Exceptions;
use Illuminate\Support\Str;
use Symfony\Component\Mailer\Exception\TransportException;
use Tests\Support\ScriptedTransport;

/** The shape of `SystemStatus` (phase plan 8 "REST"; the clickdummy's types.ts plus backlog, delays, Meilisearch tasks and live). */
$shape = ['version', 'queued_jobs', 'delayed_jobs', 'queues', 'failed_jobs', 'failed_jobs_total', 'search', 'search_tasks', 'mail_configured', 'live'];

it('shows the system to an org admin', function () use ($shape) {
    $this->travelTo(now()->parse('2026-11-03 10:00:00', 'UTC'));
    DB::table('jobs')->insert(['queue' => 'search', 'payload' => '{}', 'attempts' => 0, 'reserved_at' => null,
        'available_at' => now()->getTimestamp() - 60, 'created_at' => now()->getTimestamp() - 60]);
    DB::table('failed_jobs')->insert(['uuid' => $uuid = (string) Str::uuid(), 'connection' => 'database', 'queue' => 'webhooks',
        'payload' => json_encode(['displayName' => 'App\\Jobs\\DeliverWebhook']), 'exception' => "cURL error 28\n#0 …",
        'failed_at' => '2026-11-02 09:00:00']);

    $response = $this->actingAs(User::factory()->admin()->create())->getJson('/api/v1/system')->assertOk();

    expect(array_keys($response->json('data')))->toBe($shape)
        ->and($response->json('data'))->toMatchArray([
            'queued_jobs' => 1, 'delayed_jobs' => 0, 'failed_jobs_total' => 1, 'search' => 'down', 'search_tasks' => null,
            'mail_configured' => false, 'live' => 'off',
        ])
        ->and($response->json('data.queues.4'))->toBe(['queue' => 'search', 'pending' => 1, 'oldest_at' => '2026-11-03T09:59:00.000000Z'])
        ->and($response->json('data.queues.0'))->toBe(['queue' => 'default', 'pending' => 0, 'oldest_at' => null])
        ->and($response->json('data.failed_jobs'))->toBe([[
            'id' => $uuid, 'queue' => 'webhooks', 'job' => 'App\\Jobs\\DeliverWebhook', 'error' => 'cURL error 28',
            'failed_at' => '2026-11-02T09:00:00.000000Z',
        ]]);

    searchEngine();
    $this->getJson('/api/v1/system')->assertJsonPath('data.search', 'ok')
        ->assertJsonPath('data.search_tasks', ['enqueued' => 0, 'processing' => 0, 'failed_last_day' => 0]);
});

it('puts failed jobs back and sends the test mail', function () {
    DB::table('failed_jobs')->insert(['uuid' => $uuid = (string) Str::uuid(), 'connection' => 'database', 'queue' => 'default',
        'payload' => '{"attempts":2}', 'exception' => 'x', 'failed_at' => now()->utc()]);
    $this->actingAs($admin = User::factory()->admin()->create(['email' => 'lena@example.com']));

    $this->postJson('/api/v1/system/failed-jobs/retry', ['ids' => [$uuid]])->assertOk()->assertExactJson(['retried' => 1]);
    $this->postJson('/api/v1/system/failed-jobs/retry')->assertOk()->assertExactJson(['retried' => 0]);
    $this->postJson('/api/v1/system/failed-jobs/retry', ['ids' => ['nope']])->assertUnprocessable()
        ->assertJsonPath('errors.ids', [__('field.ids.failed_jobs', ['max' => 100])]);

    $this->postJson('/api/v1/system/test-mail')->assertConflict()
        ->assertJsonPath('reason', 'mail_not_configured')->assertJsonPath('detail', __('problem.reason.mail_not_configured'));

    ScriptedTransport::use(fn () => null);
    $this->postJson('/api/v1/system/test-mail')->assertOk()->assertExactJson(['sent_to' => 'lena@example.com']);
});

it('answers 503 mail_failed and reports the cause once', function () {
    Exceptions::fake();
    $this->actingAs(User::factory()->admin()->create());
    ScriptedTransport::use(fn () => throw new TransportException('Connection refused'));

    $this->postJson('/api/v1/system/test-mail')->assertStatus(503)
        ->assertJsonPath('reason', 'mail_failed')->assertJsonPath('detail', __('problem.reason.mail_failed'));

    // the cause, not the 503 that tells the client
    Exceptions::assertReportedCount(1);
    Exceptions::assertReported(TransportException::class);
});

it('sends at most six test mails a minute per account (T11-M4)', function () {
    $this->actingAs(User::factory()->admin()->create());
    $server = ScriptedTransport::use(fn () => null);

    foreach (range(1, 6) as $n) {
        $this->postJson('/api/v1/system/test-mail')->assertOk();
    }
    $this->postJson('/api/v1/system/test-mail')->assertStatus(429)->assertJsonPath('reason', 'too_many_requests');

    expect($server->count())->toBe(6);
    // another admin has their own six (the session by its guard: the throttle keys it by `web`, RateKey)
    forgetApiAuth();
    $this->actingAs(User::factory()->admin()->create(), 'web')->postJson('/api/v1/system/test-mail')->assertOk();
});

it('refuses members with 403 and the reason', function (string $method, string $path) {
    $this->actingAs(User::factory()->create())->json($method, $path)->assertForbidden()
        ->assertJsonPath('detail', __('problem.detail.system_admins_only'));
})->with([
    ['GET', '/api/v1/system'],
    ['POST', '/api/v1/system/failed-jobs/retry'],
    ['POST', '/api/v1/system/test-mail'],
]);

it('lets a read token read the system and wants write for the rest', function () {
    $admin = User::factory()->admin()->create();

    $this->withToken(apiToken($admin, ['read']))->getJson('/api/v1/system')->assertOk();
    $this->postJson('/api/v1/system/failed-jobs/retry')->assertForbidden();
    $this->postJson('/api/v1/system/test-mail')->assertForbidden();
});
