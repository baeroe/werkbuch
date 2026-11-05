<?php

namespace App\Actions\Webhooks;

use App\Access\Visibility;
use App\Events\EventType;
use App\Jobs\DeliverWebhook;
use App\Models\Event;
use App\Models\Project;
use App\Models\User;
use App\Models\Webhook;
use App\Models\WebhookDelivery;
use App\Models\WorkItem;
use App\Support\Actor;
use App\Webhooks\WebhookPayload;
use Illuminate\Database\Eloquent\Builder;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Turns an event of the outbox into one delivery per webhook that takes it (spec 6.3, A362, A364, A370): the active
 * webhooks the system has not switched off, whose patterns name the event; a project webhook only for its own project
 * and never for a project being deleted, an organization webhook for a project being deleted only `project.deleted`;
 * a webhook with a bot only while the bot sees the project (active, member or public), and only for what concerns it
 * (`bot.*` of it, `work_item.*`/`comment.*` of an item it is assigned to when consumed, it was assigned to before or
 * after the change, or a deleted item it had, K9). The body is built once per reader (the bot, else the default bot, A363) and
 * stored with the delivery; the rows go in with `insertOrIgnore` over (`event_id`, `webhook_id`), in the order of the
 * webhooks (K16), so an event that arrives twice (redispatch, queue:retry without the claim) writes nothing twice; only
 * the rows this call inserted (its own ULIDs) get a job, after the commit. Runs in the claim transaction of
 * WebhookConsumer; work of a job without an event of its own, like NotifyRecipients.
 */
final class QueueDeliveries
{
    use AsAction;

    /**
     * @return int how many deliveries it queued
     */
    public function handle(Actor $actor, Event $event): int
    {
        $type = $event->type;
        if (! $type->webhook()) {
            return 0;
        }

        $webhooks = Webhook::query()
            ->where('active', true)->whereNull('disabled_at')
            ->where(fn (Builder $query) => $query->whereNull('project_id')->when($event->project_id !== null, fn (Builder $query) => $query->orWhere('project_id', $event->project_id)))
            ->with('bot')->orderBy('id')->get()
            ->filter(fn (Webhook $webhook) => $webhook->matches($type));
        if ($webhooks->isEmpty()) {
            return 0;
        }

        $project = $event->project_id === null ? null : Project::query()->find($event->project_id);
        $deleting = $event->project_id !== null && ($project === null || $project->deleting_at !== null);
        Visibility::forget();

        $assignee = $this->assignee($event, $webhooks->contains(fn (Webhook $webhook) => $webhook->bot_id !== null));
        $bodies = $rows = [];
        $now = now();
        foreach ($webhooks as $webhook) {
            if ($deleting && ($webhook->project_id !== null || $type !== EventType::ProjectDeleted)) {
                continue;
            }
            $bot = $webhook->bot;
            if ($bot !== null && ! $this->reaches($bot, $event, $deleting ? null : $project, $assignee)) {
                continue;
            }

            $reader = $bot ?? User::defaultBot();
            $rows[] = [
                'id' => (new WebhookDelivery)->newUniqueId(),
                'webhook_id' => $webhook->id,
                'event_id' => $event->id,
                'event' => $type->value,
                'body' => $bodies[$reader->id] ??= WebhookPayload::encode(WebhookPayload::for($event, $reader)),
                'status' => WebhookDelivery::PENDING,
                'attempts' => 0,
                'created_at' => $now->format('Y-m-d H:i:s.u'),
                'updated_at' => $now->format('Y-m-d H:i:s'),
            ];
        }
        if ($rows === []) {
            return 0;
        }

        WebhookDelivery::query()->insertOrIgnore($rows);

        $byId = $webhooks->keyBy('id');
        $deliveries = WebhookDelivery::query()->whereKey(array_column($rows, 'id'))->orderBy('webhook_id')->get();
        foreach ($deliveries as $delivery) {
            $delivery->setRelation('webhook', $byId[$delivery->webhook_id]);
            DeliverWebhook::enqueue($delivery);
        }

        return $deliveries->count();
    }

    /**
     * Whether the event goes to the webhook of the bot (A364, K9): the bot sees the project (read afresh; a deactivated
     * account sees none), and the event concerns it.
     */
    private function reaches(User $bot, Event $event, ?Project $project, ?string $assignee): bool
    {
        if ($project === null || Visibility::roleIn($bot, $project) === null) {
            return false;
        }

        $type = $event->type;
        if ($type->group() === 'bot') {
            return ($event->meta['bot_id'] ?? null) === $bot->id;
        }
        if (! in_array($type->group(), ['work_item', 'comment'], true)) {
            return false;
        }

        $change = $event->changes['assignee_id'] ?? null;
        $had = $type === EventType::WorkItemDeleted ? ($event->meta['assignee_id'] ?? null) : null;

        return in_array($bot->id, [$assignee, $change['old'] ?? null, $change['new'] ?? null, $had], true);
    }

    /**
     * The assignee of the item of the event when consumed (the subject of `work_item.*` and `comment.*`, A227), read
     * only when a webhook with a bot may need it.
     */
    private function assignee(Event $event, bool $bots): ?string
    {
        if (! $bots || ! in_array($event->type->group(), ['work_item', 'comment'], true)) {
            return null;
        }
        $id = WorkItem::query()->whereKey($event->subject_id)->value('assignee_id');

        return is_string($id) ? $id : null;
    }
}
