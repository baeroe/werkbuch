<?php

namespace App\Actions\Notifications;

use App\Access\Visibility;
use App\Domain\Notifications\Channel;
use App\Domain\Notifications\NotificationKind;
use App\Domain\Notifications\Preferences;
use App\Domain\Notifications\Recipients;
use App\Enums\AccountType;
use App\Models\Event;
use App\Models\Notification;
use App\Models\NotificationPreference;
use App\Models\Project;
use App\Models\User;
use App\Support\Actor;
use App\Support\MailSetup;
use App\Support\NotificationFacts;
use Illuminate\Support\Collection;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Turns an event of the outbox into notifications (spec 4.14, phase plan 8 "Empfängerregel"): Recipients decides who
 * hears of it as what; of them only active people who still see the project count (Visibility, read afresh). Each gets
 * at most one row, of the first of their kinds that has a channel on (A267): `inbox` says whether the inbox shows it,
 * a row with only mail on stays out of the inbox (A271). Mail counts as off while no mail server is set (K9). The row
 * is unique per person and event (`dedupe_key` `event:<id>`): an event that arrives twice writes once, besides the
 * claim of the outbox. Runs in the claim transaction of NotificationConsumer; work of a job without an event of its
 * own, like PurgeProject.
 */
final class NotifyRecipients
{
    use AsAction;

    /**
     * @return int how many notifications it wrote
     */
    public function handle(Actor $actor, Event $event): int
    {
        $facts = NotificationFacts::of($event);
        $recipients = $facts === null ? [] : Recipients::of($facts);
        if ($facts === null || $recipients === []) {
            return 0;
        }

        $people = $this->reachable((string) $facts->projectId, array_map(fn ($recipient) => $recipient->userId, $recipients));
        $stored = $this->preferences(array_values($people->keys()->all()));
        $mail = MailSetup::configured();
        $described = null;
        $created = $event->occurred_at->format('Y-m-d H:i:s.u');
        $now = now()->format('Y-m-d H:i:s.u');

        $rows = [];
        foreach ($recipients as $recipient) {
            if (! $people->has($recipient->userId)) {
                continue;
            }
            $theirs = $stored[$recipient->userId] ?? [];

            foreach ($recipient->kinds as $kind) {
                $inbox = Preferences::enabled($kind, Channel::Inbox, $theirs);
                if (! $inbox && ! ($mail && Preferences::enabled($kind, Channel::Mail, $theirs))) {
                    continue;
                }

                $inDescription = false;
                if ($kind === NotificationKind::Mentioned && ! str_starts_with($facts->type, 'comment.')) {
                    $described ??= NotificationFacts::describedIn((string) $facts->itemId);
                    $inDescription = in_array($recipient->userId, $described, true);
                }

                $rows[] = [
                    'id' => (new Notification)->newUniqueId(),
                    'user_id' => $recipient->userId,
                    'kind' => $kind->value,
                    'event_id' => $event->id,
                    'project_id' => $facts->projectId,
                    'work_item_id' => $facts->itemId,
                    'actor_id' => $event->actor_id,
                    'data' => json_encode(NotificationFacts::data($event, $kind, $inDescription), JSON_THROW_ON_ERROR),
                    'inbox' => $inbox,
                    'dedupe_key' => "event:{$event->id}",
                    // the moment of the event, not of the consumer (P2): a late consumer sorts it where it happened
                    'created_at' => $created,
                    'updated_at' => $now,
                ];
                break;
            }
        }

        return $rows === [] ? 0 : Notification::query()->insertOrIgnore($rows);
    }

    /**
     * The candidates who are active people and see the project now, by ID, with a fixed number of queries however many
     * there are (Visibility::seeing); the role index is read afresh (A35), a change of access earlier in the same
     * process counts.
     *
     * @param  list<string>  $ids
     * @return Collection<string, User>
     */
    private function reachable(string $projectId, array $ids): Collection
    {
        Visibility::forget();
        $project = Project::query()->find($projectId);
        $people = User::query()->whereKey($ids)->where('type', AccountType::Person)->get();

        return collect($project === null ? [] : Visibility::seeing($project, $people))->keyBy('id');
    }

    /**
     * The stored choices of the people, `"<kind>:<channel>" => enabled` per person, in one query.
     *
     * @param  list<string>  $ids
     * @return array<string, array<string, bool>>
     */
    private function preferences(array $ids): array
    {
        $stored = [];
        foreach (NotificationPreference::query()->whereIn('user_id', $ids)->get() as $preference) {
            $stored[$preference->user_id]["{$preference->kind->value}:{$preference->channel->value}"] = $preference->enabled;
        }

        return $stored;
    }
}
