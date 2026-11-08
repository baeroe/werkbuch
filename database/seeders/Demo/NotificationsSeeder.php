<?php

namespace Database\Seeders\Demo;

use App\Domain\Notifications\NotificationKind;
use App\Models\Comment;
use App\Models\Notification;
use App\Models\Project;
use App\Models\Template;
use App\Models\User;
use App\Models\Webhook;
use App\Models\WorkflowState;
use App\Models\WorkItem;
use App\Support\StateSnapshot;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * Mara's inbox, the 14 notifications of the clickdummy (src/api/seed/inbox.ts; `NotificationsSeederTest` reads that
 * file and compares row by row), 3 of them unread. Each row keeps the `data` its kind stores in the app (table
 * "Benachrichtigungsarten" of the phase plan 8): a comment `[key, n]` is the n-th comment of the item by time, as the
 * CommentsSeeder writes them, a state change the snapshot of the two states of the item's workflow (StateSnapshot, like
 * `meta.states`); `template_run_failed` names its template (the TemplatesSeeder runs before). `webhook_disabled` names the webhook
 * "Altes CRM" (the WebhooksSeeder runs before). Written directly, without events and without mail
 * collections (A86); no row points to an event (`event_id` null), the demo history has no IDs of the clickdummy.
 *
 * Safe to run again (like K13): it creates the rows whose `dedupe_key` (`seed:<n_id>`) Mara lacks and never changes
 * one that exists, so what she read since stays so (a deleted one comes back). A row whose item, comment or states
 * are gone (the project switched its workflow) stays out.
 */
class NotificationsSeeder extends Seeder
{
    use WithoutModelEvents;

    /**
     * id, kind, item key (or `project` => identifier|null without an item), actor handle, `data`, created and read
     * (`MM-DD HH:mm`, Berlin time; read null = unread). `comment` names the comment, `states` the moved states (keys of
     * ItemsSeeder::state()).
     *
     * @var list<array{id: string, kind: NotificationKind, item?: string, project?: string|null, template?: string, webhook?: string, actor?: string, data?: array<string, mixed>, comment?: array{0: string, 1: int}, states?: array{0: string, 1: string}, created: string, read?: string, seconds?: int}>
     */
    private const ROWS = [
        // unread
        ['id' => 'n_01', 'kind' => NotificationKind::Mentioned, 'item' => 'WEB-42', 'actor' => 'ida', 'data' => ['source' => 'comment'], 'comment' => ['WEB-42', 1], 'created' => '10-28 08:40'],
        ['id' => 'n_03', 'kind' => NotificationKind::Comment, 'item' => 'APP-15', 'actor' => 'theo', 'comment' => ['APP-15', 1], 'created' => '10-27 15:10'],
        ['id' => 'n_04', 'kind' => NotificationKind::Assigned, 'item' => 'APP-24', 'actor' => 'theo', 'created' => '10-27 16:05'],
        // read
        ['id' => 'n_02', 'kind' => NotificationKind::Due, 'item' => 'APP-18', 'data' => ['due_date' => '2026-10-28', 'overdue' => false], 'created' => '10-28 08:00', 'read' => '10-28 08:10'],
        ['id' => 'n_05', 'kind' => NotificationKind::StateChanged, 'item' => 'OPS-11', 'actor' => 'jonas', 'states' => ['progress', 'done'], 'created' => '10-27 14:00', 'read' => '10-27 16:00'],
        ['id' => 'n_06', 'kind' => NotificationKind::ItemChanged, 'item' => 'WEB-47', 'actor' => 'ida', 'data' => ['fields' => ['priority']], 'created' => '10-27 10:20', 'read' => '10-27 12:00'],
        ['id' => 'n_07', 'kind' => NotificationKind::StateChanged, 'item' => 'WEB-47', 'actor' => 'jonas', 'states' => ['todo', 'progress'], 'created' => '10-27 09:15', 'read' => '10-27 12:00'],
        ['id' => 'n_08', 'kind' => NotificationKind::Comment, 'item' => 'OPS-12', 'actor' => 'jonas', 'comment' => ['OPS-12', 2], 'created' => '10-26 16:30', 'read' => '10-27 08:30'],
        ['id' => 'n_09', 'kind' => NotificationKind::Mentioned, 'item' => 'OPS-3', 'actor' => 'jonas', 'data' => ['source' => 'comment'], 'comment' => ['OPS-3', 1], 'created' => '10-26 17:00', 'read' => '10-27 08:30'],
        ['id' => 'n_11', 'kind' => NotificationKind::StateChanged, 'item' => 'WEB-40', 'actor' => 'lene', 'states' => ['todo', 'done'], 'created' => '10-23 14:10', 'read' => '10-23 16:00'],
        // the webhook "Altes CRM" (phase 11): an organization notification without a project (K5)
        ['id' => 'n_10', 'kind' => NotificationKind::WebhookDisabled, 'project' => null, 'webhook' => 'Altes CRM', 'created' => '10-22 10:00', 'read' => '10-23 09:00'],
        ['id' => 'n_12', 'kind' => NotificationKind::Assigned, 'item' => 'APP-18', 'actor' => 'theo', 'created' => '10-21 11:00', 'read' => '10-21 13:00'],
        // the mention in the description of WEB-47
        ['id' => 'n_13', 'kind' => NotificationKind::Mentioned, 'item' => 'WEB-47', 'actor' => 'ida', 'data' => ['source' => 'description'], 'created' => '10-20 11:30', 'read' => '10-20 15:00'],
        // the template "Zertifikate prüfen"
        ['id' => 'n_14', 'kind' => NotificationKind::TemplateRunFailed, 'project' => 'OPS', 'template' => 'Zertifikate prüfen', 'data' => ['error' => 'Pflicht-Property Umgebung fehlt'], 'created' => '10-01 07:00', 'read' => '10-02 09:00', 'seconds' => 5],
    ];

    public function run(): void
    {
        DB::transaction(function (): void {
            $mara = User::query()->where('handle', 'mara')->first() ?? throw new RuntimeException('No account @mara.');
            $people = User::query()->pluck('id', 'handle');
            $present = Notification::query()->where('user_id', $mara->id)->where('dedupe_key', 'like', 'seed:%')->pluck('dedupe_key')->flip();

            foreach (self::ROWS as $row) {
                if (! $present->has("seed:{$row['id']}")) {
                    $this->write($mara, $row, $people->all());
                }
            }
        });
    }

    /**
     * @param  array{id: string, kind: NotificationKind, item?: string, project?: string|null, template?: string, webhook?: string, actor?: string, data?: array<string, mixed>, comment?: array{0: string, 1: int}, states?: array{0: string, 1: string}, created: string, read?: string, seconds?: int}  $row
     * @param  array<string, string>  $people  IDs by handle
     */
    private function write(User $mara, array $row, array $people): void
    {
        $item = isset($row['item']) ? ItemsSeeder::find($row['item']) : null;
        if (isset($row['item']) && $item === null) {
            return;
        }

        $data = $row['data'] ?? [];
        if (isset($row['template'])) {
            // as the app stores it: the template first (its ID, or null when it is gone), then the error
            $data = ['template_id' => Template::query()->where('project_id', $this->project($row['project'] ?? null))->where('name', $row['template'])->value('id'), ...$data];
        }
        if (isset($row['webhook'])) {
            // as the app stores it (NotificationFacts): the webhook and its name at the time; one that is gone stays out
            $id = Webhook::query()->where('name', $row['webhook'])->value('id');
            if ($id === null) {
                return;
            }
            $data = ['webhook_id' => $id, 'name' => $row['webhook']];
        }
        if (isset($row['comment'])) {
            $data['comment_id'] = $this->comment(...$row['comment']);
            if ($data['comment_id'] === null) {
                return;
            }
        }
        if (isset($row['states']) && $item !== null) {
            $from = $this->state($item, $row['states'][0]);
            $to = $this->state($item, $row['states'][1]);
            if ($from === null || $to === null) {
                return;
            }
            $snapshot = StateSnapshot::of($from, $to);
            $data = ['from' => $snapshot['old'], 'to' => $snapshot['new']];
        }

        $created = ItemsSeeder::at($row['created'], $row['seconds'] ?? 0);
        $read = isset($row['read']) ? ItemsSeeder::at($row['read']) : null;

        (new Notification)->forceFill([
            'user_id' => $mara->id,
            'kind' => $row['kind'],
            'project_id' => $item !== null ? $item->project_id : $this->project($row['project'] ?? null),
            'work_item_id' => $item?->id,
            'actor_id' => isset($row['actor']) ? ($people[$row['actor']] ?? throw new RuntimeException("No account @{$row['actor']}.")) : null,
            'data' => $data,
            'inbox' => true,
            'dedupe_key' => "seed:{$row['id']}",
            'read_at' => $read,
            'created_at' => $created,
            'updated_at' => $read ?? $created,
        ])->save();
    }

    /** The n-th comment of the item by time (`c_<item>_<n>` of the clickdummy), if it is still there. */
    private function comment(string $key, int $n): ?string
    {
        $id = Comment::query()->where('work_item_id', ItemsSeeder::find($key)?->id)
            ->orderBy('created_at')->orderBy('id')->skip($n - 1)->value('id');

        return is_string($id) ? $id : null;
    }

    /** The state of that name (a key of ItemsSeeder::state()) in the workflow the item's project has now, if it has one. */
    private function state(WorkItem $item, string $key): ?WorkflowState
    {
        $workflow = Project::query()->whereKey($item->project_id)->value('workflow_id');

        return WorkflowState::query()->where('workflow_id', $workflow)->where('name', ItemsSeeder::state($key))->first();
    }

    private function project(?string $identifier): ?string
    {
        return $identifier === null ? null : Project::query()->where('identifier', $identifier)->value('id');
    }
}
