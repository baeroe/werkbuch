<?php

use App\Models\Event;
use App\Models\User;
use App\Models\Webhook;
use App\Models\WebhookAttempt;
use App\Models\WebhookDelivery;
use Carbon\CarbonImmutable;
use Database\Seeders\Demo\ItemsSeeder;
use Database\Seeders\Demo\WebhooksSeeder;
use Database\Seeders\DemoSeeder;
use Illuminate\Support\Facades\Storage;

beforeEach(fn () => Storage::fake('local'));

/** A time of the seed as UTC text: `YYYY-MM-DDTHH:mm:ss.000Z` is UTC already, `MM-DD HH:mm` is Berlin wall clock. */
$utc = fn (string $when): string => str_contains($when, 'T')
    ? CarbonImmutable::parse($when)->utc()->format('Y-m-d H:i:s')
    : ItemsSeeder::at($when)->format('Y-m-d H:i:s');

/**
 * The webhooks and deliveries of the clickdummy (src/api/seed/inbox.ts), parsed from the file: a row copied wrong, a
 * missed one or a changed seed shows here. In the file every attempt is a row (`attempt` 2 and more continue the
 * delivery before it); the app has one delivery per event with its attempts.
 *
 * @return array{webhooks: array<string, array<string, mixed>>, deliveries: list<array<string, mixed>>}
 */
$clickdummy = function () use ($utc): array {
    $source = (string) file_get_contents(repo_path('prototypes/clickdummy/src/api/seed/inbox.ts'));
    $hooks = substr($source, (int) strpos($source, 'export const webhooks'), (int) strpos($source, 'function delivery') - (int) strpos($source, 'export const webhooks'));
    $rows = substr($source, (int) strpos($source, 'export const webhookDeliveries'), (int) strpos($source, 'export const system') - (int) strpos($source, 'export const webhookDeliveries'));

    $webhooks = [];
    foreach (array_slice(preg_split("/(?=\bid: 'wh_)/", $hooks) ?: [], 1) as $chunk) {
        $field = fn (string $name): ?string => preg_match("/\b{$name}: '([^']*)'/", $chunk, $match) === 1 ? $match[1] : null;
        preg_match('/events: \[([^\]]*)\]/', $chunk, $events);
        $created = preg_match("/created_at: at\('([^']+)'\)/", $chunk, $at) === 1 ? $at[1] : null;
        $webhooks[(string) $field('name')] = [
            'id' => $field('id'),
            'url' => $field('url'),
            'project' => $field('project_id') === null ? null : strtoupper(substr((string) $field('project_id'), 2)),
            'events' => array_map(fn (string $e) => trim($e, " '"), explode(',', $events[1])),
            'bot' => preg_match('/bot_id: USER_IDS\.(\w+)/', $chunk, $bot) === 1 ? $bot[1] : null,
            'active' => str_contains($chunk, 'active: true'),
            'disabled_at' => $field('disabled_at') === null ? null : $utc((string) $field('disabled_at')),
            'created_at' => $utc((string) $created),
        ];
    }

    $deliveries = [];
    preg_match_all("/delivery\('(\w+)', '(\w+)', '([\w.]+)', '([^']+)', (\d+|null), (\d+)(?:, \{(.*)\})?\),?$/m", $rows, $found, PREG_SET_ORDER);
    foreach ($found as $match) {
        $options = $match[7] ?? '';
        $attempt = (int) (preg_match('/attempt: (\d+)/', $options, $n) === 1 ? $n[1] : 1);
        $row = [
            'attempt' => $attempt,
            'status' => $match[5] === 'null' ? null : (int) $match[5],
            'duration' => (int) $match[6],
            'excerpt' => preg_match("/excerpt: '([^']*)'/", $options, $e) === 1 ? $e[1] : ($match[5] === '200' ? '{"ok":true}' : null),
            'error' => preg_match('/error: (TIMEOUT)/', $options) === 1 ? 'Zeitüberschreitung nach 10 s' : null,
            'at' => $utc($match[4]),
        ];
        if ($attempt === 1) {
            $deliveries[] = ['webhook' => $match[2], 'event' => $match[3], 'attempts' => [$row]];
        } else {
            $deliveries[array_key_last($deliveries)]['attempts'][] = $row;
        }
    }

    return ['webhooks' => $webhooks, 'deliveries' => $deliveries];
};

it('seeds the webhooks of the clickdummy', function () use ($clickdummy) {
    $this->seed(DemoSeeder::class);
    $seed = $clickdummy();

    expect(Webhook::query()->count())->toBe(3)->and(array_keys($seed['webhooks']))->toBe(['Deploy-Bot', 'Kira', 'Altes CRM']);

    foreach ($seed['webhooks'] as $name => $expected) {
        $webhook = Webhook::query()->with(['project', 'bot'])->where('name', $name)->sole();
        expect([
            'url' => $webhook->url,
            'project' => $webhook->project?->identifier,
            'events' => $webhook->events,
            'bot' => $webhook->bot?->handle,
            'active' => $webhook->active,
            'disabled_at' => $webhook->disabled_at?->format('Y-m-d H:i:s'),
            'created_at' => $webhook->created_at?->format('Y-m-d H:i:s'),
        ])->toBe([
            'url' => $expected['url'],
            'project' => $expected['project'],
            'events' => $expected['events'],
            'bot' => $expected['bot'],
            'active' => $expected['active'],
            'disabled_at' => $expected['disabled_at'],
            'created_at' => $expected['created_at'],
        ], $name)
            ->and($webhook->secret)->toStartWith('whsec_')
            ->and(User::query()->whereKey($webhook->created_by)->value('handle'))->toBe('mara');
    }

    // the CRM failed for 24 hours and was switched off; the others last answered at their last success
    $crm = Webhook::query()->where('name', 'Altes CRM')->sole();
    expect($crm->failing_since?->format('Y-m-d H:i:s'))->toBe('2026-10-21 08:00:00')
        ->and($crm->last_success_at)->toBeNull()
        ->and(Webhook::query()->where('name', 'Deploy-Bot')->sole()->last_success_at?->format('Y-m-d H:i:s'))->toBe(ItemsSeeder::at('10-27 16:20')->format('Y-m-d H:i:s'))
        ->and(Webhook::query()->where('name', 'Deploy-Bot')->sole()->failing_since)->toBeNull();
});

it('seeds one delivery per event with the 18 attempts of the clickdummy', function () use ($clickdummy) {
    $this->seed(DemoSeeder::class);
    $seed = $clickdummy();
    $names = Webhook::query()->pluck('name', 'id');
    $byId = collect($seed['webhooks'])->mapWithKeys(fn (array $hook, string $name) => [$hook['id'] => $name]);

    $stored = WebhookDelivery::query()->orderBy('created_at')->get();
    expect($stored)->toHaveCount(count($seed['deliveries']))->toHaveCount(10)
        ->and(WebhookAttempt::query()->count())->toBe(18);

    $expected = collect($seed['deliveries'])->sortBy(fn (array $d) => $d['attempts'][0]['at'])->values();
    foreach ($stored as $i => $delivery) {
        $row = $expected[$i];
        expect([$names[$delivery->webhook_id], $delivery->event, $delivery->body, $delivery->event_id, $delivery->attempts])
            ->toBe([$byId[$row['webhook']], $row['event'], '{}', null, count($row['attempts'])])
            // the delivery began with its first attempt and ends as its last one did
            ->and($delivery->created_at?->format('Y-m-d H:i:s'))->toBe($row['attempts'][0]['at'])
            ->and($delivery->status)->toBe(($row['attempts'][array_key_last($row['attempts'])]['status'] ?? 0) === 200 ? WebhookDelivery::SUCCEEDED : WebhookDelivery::FAILED);

        foreach ($delivery->attempts()->get() as $j => $attempt) {
            $want = $row['attempts'][$j];
            expect([$attempt->attempt, $attempt->kind, $attempt->status_code, $attempt->duration_ms, $attempt->response_excerpt, $attempt->error, $attempt->attempted_at->format('Y-m-d H:i:s'), $attempt->webhook_id])
                ->toBe([$want['attempt'], WebhookAttempt::SCHEDULED, $want['status'], $want['duration'], $want['excerpt'], $want['error'], $want['at'], $delivery->webhook_id]);
        }
    }
});

it('runs twice without change and writes no events', function () {
    $this->seed(DemoSeeder::class);
    $before = [Webhook::query()->get()->map->getAttributes()->all(), WebhookDelivery::query()->count(), WebhookAttempt::query()->count(), Event::query()->count()];

    $this->seed(WebhooksSeeder::class);

    expect([Webhook::query()->get()->map->getAttributes()->all(), WebhookDelivery::query()->count(), WebhookAttempt::query()->count(), Event::query()->count()])->toBe($before);
});

it('creates only the webhooks it lacks and leaves a changed one alone', function () {
    $this->seed(DemoSeeder::class);
    $secret = Webhook::query()->where('name', 'Kira')->sole()->secret;
    Webhook::query()->where('name', 'Deploy-Bot')->update(['url' => 'https://elsewhere.example.com/hook']);
    Webhook::query()->where('name', 'Altes CRM')->delete();

    $this->seed(WebhooksSeeder::class);

    expect(Webhook::query()->count())->toBe(3)
        ->and(Webhook::query()->where('name', 'Deploy-Bot')->sole()->url)->toBe('https://elsewhere.example.com/hook')
        ->and(Webhook::query()->where('name', 'Kira')->sole()->secret)->toBe($secret)
        ->and(WebhookAttempt::query()->count())->toBe(18);
});

it('fails clearly when the account of a webhook is missing', function () {
    $this->seed(DemoSeeder::class);
    Webhook::query()->delete();
    User::query()->where('handle', 'kira')->each(fn (User $user) => $user->forceFill(['handle' => 'kira2'])->save());

    $this->seed(WebhooksSeeder::class);
})->throws(RuntimeException::class, 'No account @kira.');
