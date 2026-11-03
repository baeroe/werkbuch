<?php

namespace App\Actions\Notifications;

use App\Access\Visibility;
use App\Domain\Notifications\Channel;
use App\Domain\Notifications\NotificationKind;
use App\Domain\Notifications\Preferences;
use App\Domain\Notifications\Recipients;
use App\Enums\AccountType;
use App\Jobs\SendNotificationMailJob;
use App\Models\Event;
use App\Models\Notification;
use App\Models\NotificationMail;
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
 * a row with only mail on stays out of the inbox (A271). Mail counts as off while no mail server is set (K9, A274). The
 * row is unique per person and event (`dedupe_key` `event:<id>`): an event that arrives twice writes once, besides the
 * claim of the outbox. A row with mail on joins the open mail collection of its person and item (phase plan 8 "Mail",
 * A273), which the first one opens; SendNotificationMail sends it once it is due. Runs in the claim transaction of
 * NotificationConsumer; work of a job without an event of its own, like PurgeProject.
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
        $stored = NotificationPreference::storedFor(array_values($people->keys()->all()));
        $mail = MailSetup::configured();
        $described = null;
        $created = $event->occurred_at->format('Y-m-d H:i:s.u');
        $now = now()->format('Y-m-d H:i:s.u');

        $rows = $mailing = [];
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
                if ($mail && Preferences::enabled($kind, Channel::Mail, $theirs)) {
                    $mailing[] = $recipient->userId;
                }
                break;
            }
        }

        $mails = self::collect($this->unwritten($event, $mailing), "item:{$facts->itemId}");
        $rows = array_map(fn (array $row) => [...$row, 'mail_id' => $mails[$row['user_id']] ?? null], $rows);

        return Notification::query()->insertOrIgnore($rows);
    }

    /**
     * The people among the IDs who have no notification of the event yet: only they join a mail (a second delivery of
     * the event writes nothing, its rows joined their mails the first time). No query without anybody to mail.
     *
     * @param  list<string>  $ids
     * @return list<string>
     */
    private function unwritten(Event $event, array $ids): array
    {
        if ($ids === []) {
            return [];
        }
        $written = Notification::query()->where('dedupe_key', "event:{$event->id}")->whereIn('user_id', $ids)->pluck('user_id')->all();

        return array_values(array_diff($ids, $written));
    }

    /**
     * The open mail collection of each person for the scope, by person, locked until the claim commits (K7): one insert
     * for all that are missing, which the unique `open_key` decides against a second consumer, then one locking read.
     * The insert of a key whose collection SendNotificationMail is sending waits for the send and then opens a new one;
     * should a collection close between the insert and the read all the same, the read does not find it and a second
     * round opens a new one: no line ever joins a mail that went out. A collection that is due but not sent yet stays
     * open, a line joins it and goes out with it. A new collection gets its job, after its delay and only after the
     * commit. Shared with SendDueReminders (scope `due:<day>`); runs inside the caller's transaction.
     *
     * @param  list<string>  $ids
     * @return array<string, string> the collection by person
     */
    public static function collect(array $ids, string $scope): array
    {
        $due = now()->addMinutes((int) config('werkbuch.notification_mail_delay'));
        $open = [];
        for ($round = 0; $round < 2 && count($open) < count($ids); $round++) {
            $new = [];
            foreach (array_diff($ids, array_keys($open)) as $id) {
                $new["{$id}:{$scope}"] = [
                    'id' => (new NotificationMail)->newUniqueId(), 'user_id' => $id, 'scope' => $scope, 'open_key' => "{$id}:{$scope}",
                    'due_at' => $due, 'dispatched_at' => now(), 'created_at' => now(), 'updated_at' => now(),
                ];
            }
            NotificationMail::query()->insertOrIgnore(array_values($new));

            $found = NotificationMail::query()->whereIn('open_key', array_keys($new))->whereNull('sent_at')->lockForUpdate()->get(['id', 'user_id', 'open_key']);
            foreach ($found as $collection) {
                $open[$collection->user_id] = $collection->id;
                if ($collection->id === $new[(string) $collection->open_key]['id']) {
                    SendNotificationMailJob::dispatch($collection->id)->delay($due)->afterCommit();
                }
            }
        }

        return $open;
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
}
