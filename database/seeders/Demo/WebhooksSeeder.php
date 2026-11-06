<?php

namespace Database\Seeders\Demo;

use App\Models\Project;
use App\Models\User;
use App\Models\Webhook;
use App\Models\WebhookAttempt;
use App\Models\WebhookDelivery;
use Carbon\CarbonImmutable;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * The three webhooks of the clickdummy (src/api/seed/inbox.ts, `WebhooksSeederTest` reads that file): "Deploy-Bot"
 * (state changes of the organization), "Kira" (`bot.*`, the bot Kira sees) and "Altes CRM" (project APP), which the
 * system switched off after 24 hours without a success. Their 18 attempts are the log: the file has a row per attempt,
 * the app one delivery per event with its attempts (a row with `attempt` 2 and more continues the delivery before it),
 * each delivery with the empty body `{}`. `failing_since` and `last_success_at` follow from the attempts as
 * RecordWebhookAttempt keeps them. The secret is a fresh one when the webhook is made (a clickdummy secret would be a
 * known one). Written directly, without events (A86); a webhook is made when none of its name exists, so what an admin
 * changed stays, and a second run adds nothing. Berlin wall clock as everywhere in the demo data; the CRM's attempts are
 * UTC stamps, as in the file.
 *
 * The demo webhooks fire for real in development; the E2eSeeder switches them off (K8).
 */
class WebhooksSeeder extends Seeder
{
    use WithoutModelEvents;

    private const TIMEOUT = 'Zeitüberschreitung nach 10 s';

    /**
     * name, url, `project` (identifier), events, `bot` (handle), created, `disabled` (UTC).
     *
     * @var list<array{name: string, url: string, project: string|null, events: list<string>, bot: string|null, created: string, disabled: string|null}>
     */
    private const WEBHOOKS = [
        ['name' => 'Deploy-Bot', 'url' => 'https://deploy.feldwerk.example.com/hooks/werkbuch', 'project' => null, 'events' => ['work_item.state_changed'], 'bot' => null, 'created' => '10-02 10:30', 'disabled' => null],
        ['name' => 'Kira', 'url' => 'https://kira.feldwerk.example.com/werkbuch/webhook', 'project' => null, 'events' => ['bot.*'], 'bot' => 'kira', 'created' => '10-05 14:35', 'disabled' => null],
        ['name' => 'Altes CRM', 'url' => 'https://crm.example.com/api/inbound/werkbuch', 'project' => 'APP', 'events' => ['work_item.created', 'work_item.updated'], 'bot' => null, 'created' => '08-12 09:00', 'disabled' => '2026-10-22T08:00:30Z'],
    ];

    /**
     * One delivery per entry: webhook, event and its attempts `[when, status, duration ms, excerpt, error]` in order
     * (`when` Berlin `MM-DD HH:mm`, or a UTC stamp with a `T`).
     *
     * @var list<array{0: string, 1: string, 2: non-empty-list<array{0: string, 1: int|null, 2: int, 3: string|null, 4: string|null}>}>
     */
    private const DELIVERIES = [
        ['Deploy-Bot', 'work_item.state_changed', [['10-22 11:05', 200, 142, '{"ok":true}', null]]],
        ['Deploy-Bot', 'work_item.state_changed', [['10-23 14:10', 200, 188, '{"ok":true}', null]]],
        ['Deploy-Bot', 'work_item.state_changed', [['10-26 10:00', 200, 121, '{"ok":true}', null]]],
        ['Deploy-Bot', 'work_item.state_changed', [['10-27 09:15', 200, 305, '{"ok":true}', null]]],
        ['Deploy-Bot', 'work_item.state_changed', [['10-27 14:00', 200, 167, '{"ok":true}', null]]],
        ['Deploy-Bot', 'work_item.state_changed', [['10-27 16:20', 200, 154, '{"ok":true}', null]]],
        ['Kira', 'bot.assigned', [['10-26 11:20', 200, 233, '{"ok":true}', null]]],
        ['Kira', 'bot.mentioned', [['10-26 15:30', 200, 198, '{"ok":true}', null]]],
        ['Kira', 'bot.assigned', [['10-27 09:40', 502, 1204, 'Bad Gateway', null], ['10-27 09:41', 200, 219, '{"ok":true}', null]]],
        ['Altes CRM', 'work_item.updated', [
            ['2026-10-21T08:00:00Z', 500, 412, '{"error":"Internal Server Error"}', null],
            ['2026-10-21T08:01:00Z', 500, 388, '{"error":"Internal Server Error"}', null],
            ['2026-10-21T08:06:00Z', null, 10000, null, self::TIMEOUT],
            ['2026-10-21T08:36:00Z', 502, 521, 'Bad Gateway', null],
            ['2026-10-21T10:36:00Z', null, 10000, null, self::TIMEOUT],
            ['2026-10-21T16:36:00Z', 500, 447, '{"error":"Internal Server Error"}', null],
            ['2026-10-22T04:36:00Z', null, 10000, null, self::TIMEOUT],
            ['2026-10-22T08:00:00Z', 500, 460, '{"error":"Internal Server Error"}', null],
        ]],
    ];

    public function run(): void
    {
        DB::transaction(function (): void {
            $mara = User::query()->where('handle', 'mara')->first() ?? throw new RuntimeException('No account @mara.');
            $present = Webhook::query()->pluck('name')->flip();

            foreach (self::WEBHOOKS as $row) {
                if (! $present->has($row['name'])) {
                    $this->write($row, $mara);
                }
            }
        });
    }

    /**
     * @param  array{name: string, url: string, project: string|null, events: list<string>, bot: string|null, created: string, disabled: string|null}  $row
     */
    private function write(array $row, User $creator): void
    {
        $bot = $row['bot'] === null ? null : (User::query()->where('handle', $row['bot'])->value('id') ?? throw new RuntimeException("No account @{$row['bot']}."));
        $created = $this->at($row['created']);

        $webhook = (new Webhook)->forceFill([
            'name' => $row['name'],
            'url' => $row['url'],
            'secret' => Webhook::newSecret(),
            'project_id' => $row['project'] === null ? null : Project::query()->where('identifier', $row['project'])->value('id'),
            'events' => $row['events'],
            'bot_id' => $bot,
            'active' => $row['disabled'] === null,
            'disabled_at' => $row['disabled'] === null ? null : $this->at($row['disabled']),
            'created_by' => $creator->id,
            'created_at' => $created,
            'updated_at' => $created,
        ]);
        $webhook->save();

        $failing = null;
        $success = null;
        foreach (self::DELIVERIES as [$name, $event, $attempts]) {
            if ($name !== $row['name']) {
                continue;
            }
            foreach ($attempts as $attempt) {
                $when = $this->at($attempt[0]);
                if ($attempt[1] !== null && $attempt[1] < 300) {
                    [$success, $failing] = [$when, null];
                } else {
                    $failing ??= $when;
                }
            }
            $this->delivery($webhook, $event, $attempts);
        }

        $webhook->forceFill(['failing_since' => $failing, 'last_success_at' => $success])->saveQuietly();
    }

    /**
     * @param  non-empty-list<array{0: string, 1: int|null, 2: int, 3: string|null, 4: string|null}>  $attempts
     */
    private function delivery(Webhook $webhook, string $event, array $attempts): void
    {
        $first = $this->at($attempts[0][0]);
        $final = $attempts[array_key_last($attempts)];
        $last = $this->at($final[0]);
        $answer = $final[1];

        $delivery = (new WebhookDelivery)->forceFill([
            'webhook_id' => $webhook->id,
            'event_id' => null,
            'event' => $event,
            'body' => '{}',
            'status' => $answer !== null && $answer < 300 ? WebhookDelivery::SUCCEEDED : WebhookDelivery::FAILED,
            'attempts' => count($attempts),
            'created_at' => $first,
            'updated_at' => $last,
        ]);
        $delivery->save();

        foreach ($attempts as $n => [$when, $status, $duration, $excerpt, $error]) {
            (new WebhookAttempt)->forceFill([
                'delivery_id' => $delivery->id,
                'webhook_id' => $webhook->id,
                'attempt' => $n + 1,
                'kind' => WebhookAttempt::SCHEDULED,
                'status_code' => $status,
                'duration_ms' => $duration,
                'response_excerpt' => $excerpt,
                'error' => $error,
                'attempted_at' => $this->at($when),
            ])->save();
        }
    }

    private function at(string $when): CarbonImmutable
    {
        return str_contains($when, 'T') ? CarbonImmutable::parse($when)->utc() : ItemsSeeder::at($when);
    }
}
