<?php

namespace App\Actions\Notifications;

use App\Access\Visibility;
use App\Domain\Notifications\Channel;
use App\Domain\Notifications\NotificationKind;
use App\Domain\Notifications\Preferences;
use App\Domain\Notifications\Reminders;
use App\Domain\Workflow\StateCategory;
use App\Enums\AccountType;
use App\Live\NotificationsChanged;
use App\Models\Notification;
use App\Models\NotificationPreference;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkflowState;
use App\Models\WorkItem;
use App\Support\Actor;
use App\Support\MailSetup;
use Carbon\CarbonImmutable;
use DateTimeZone;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The reminders "due" and "overdue" (spec 4.14, A275), run every hour by SendDueRemindersJob for the hour it was
 * planned in (`$hourUtc`, K10: a job that waited on the queue past the hour still reminds the zones of its hour, no
 * other). For every time zone of an active person (their own, else the organization's) in which that hour is 08:xx,
 * the people of the zone are reminded of each open item assigned to them that is due on their day or before: not
 * archived, its project neither archived nor being deleted, its state neither completed nor canceled, and a project
 * they still see (Visibility, read afresh). One notification `due` per person, item and day (`dedupe_key`
 * `due:<item>:<day>`, `data` `{due_date, overdue}` by the calendar of the person), as the preferences say; mail counts
 * as off without a mail server (K9). The lines with mail on join the collection `due:<day>` of their person: one mail
 * per person and day with all of them. A run that comes again (the job twice in the hour) writes nothing and opens no
 * mail: only people who got a new line join one. A fixed number of queries per zone, however many people and items.
 * Work of a job without an event of its own. After the commit, every person with a new reminder in the inbox hears
 * `notifications.changed` on their live channel (NotificationsChanged, K10).
 */
final class SendDueReminders
{
    use AsAction;

    /**
     * @return int how many reminders it wrote
     */
    public function handle(Actor $actor, CarbonImmutable $hourUtc): int
    {
        $hour = $hourUtc->utc()->startOfHour();
        $organization = Organization::current()->timezone;
        $zones = self::active()->distinct()->pluck('timezone')->map(fn (?string $zone) => $zone ?? $organization)->unique();

        $written = 0;
        foreach ($zones as $zone) {
            if (Reminders::isReminderHour($hour, new DateTimeZone($zone))) {
                $written += $this->remind($zone, $zone === $organization, Reminders::localDay($hour, new DateTimeZone($zone)));
            }
        }

        return $written;
    }

    /** Reminds the people of the zone whose day it is `$day`. */
    private function remind(string $zone, bool $organization, string $day): int
    {
        $people = self::active()->where(fn ($query) => $query->where('timezone', $zone)->when($organization, fn ($or) => $or->orWhereNull('timezone')))
            ->get()->keyBy('id');
        $items = $this->dueItems($people, $day);
        $stored = NotificationPreference::storedFor(array_values($people->keys()->all()));
        $mail = MailSetup::configured();
        $now = now()->format('Y-m-d H:i:s.u');

        $rows = $mailing = $inboxing = [];
        foreach ($items as $item) {
            $theirs = $stored[$item->assignee_id] ?? [];
            $inbox = Preferences::enabled(NotificationKind::Due, Channel::Inbox, $theirs);
            $mailOn = $mail && Preferences::enabled(NotificationKind::Due, Channel::Mail, $theirs);
            if (! $inbox && ! $mailOn) {
                continue;
            }

            $dueDate = (string) $item->due_date?->format('Y-m-d');
            $rows["{$item->assignee_id}:due:{$item->id}:{$day}"] = [
                'id' => (new Notification)->newUniqueId(),
                'user_id' => $item->assignee_id,
                'kind' => NotificationKind::Due->value,
                'event_id' => null,
                'project_id' => $item->project_id,
                'work_item_id' => $item->id,
                'actor_id' => null,
                'data' => json_encode(['due_date' => $dueDate, 'overdue' => Reminders::dueKind($dueDate, $day) === true], JSON_THROW_ON_ERROR),
                'inbox' => $inbox,
                'dedupe_key' => "due:{$item->id}:{$day}",
                'created_at' => $now,
                'updated_at' => $now,
            ];
            if ($mailOn) {
                $mailing["{$item->assignee_id}:due:{$item->id}:{$day}"] = (string) $item->assignee_id;
            }
            if ($inbox) {
                $inboxing["{$item->assignee_id}:due:{$item->id}:{$day}"] = (string) $item->assignee_id;
            }
        }

        // a reminder the person already has stays as it is, and only a new one joins (or opens) a mail
        $written = Notification::query()->whereIn('user_id', $people->keys())->whereIn('dedupe_key', array_column($rows, 'dedupe_key'))
            ->get(['user_id', 'dedupe_key'])->map(fn (Notification $n) => "{$n->user_id}:{$n->dedupe_key}")->all();
        $rows = array_diff_key($rows, array_flip($written));
        $mailing = array_values(array_unique(array_intersect_key($mailing, $rows)));
        $inboxing = array_values(array_unique(array_intersect_key($inboxing, $rows)));

        return DB::transaction(function () use ($rows, $mailing, $inboxing, $day): int {
            $mails = NotifyRecipients::collect($mailing, "due:{$day}");
            NotificationsChanged::dispatchFor($inboxing, null);

            return Notification::query()->insertOrIgnore(array_values(array_map(
                fn (array $row) => [...$row, 'mail_id' => $mails[$row['user_id']] ?? null],
                $rows,
            )));
        }, 3);
    }

    /**
     * The open items of these people that are due on `$day` or before, of projects that are neither archived nor
     * being deleted, which their person still sees; by ID. The members of all their projects come in one query.
     *
     * @param  EloquentCollection<string, User>  $people
     * @return list<WorkItem>
     */
    private function dueItems(EloquentCollection $people, string $day): array
    {
        $items = WorkItem::query()->whereIn('assignee_id', $people->keys())->whereNull('archived_at')->where('due_date', '<=', $day)
            ->whereIn('state_id', WorkflowState::query()->select('id')->whereNotIn('category', [StateCategory::Completed, StateCategory::Canceled]))
            ->whereIn('project_id', Project::query()->select('id')->whereNull('archived_at')->whereNull('deleting_at'))
            ->with('project')->orderBy('id')->get(['id', 'project_id', 'assignee_id', 'due_date']);

        Visibility::forget();
        $projects = $items->pluck('project')->unique('id');
        Visibility::loadMembers($projects);

        $seeing = [];
        foreach ($projects as $project) {
            $assignees = $people->only($items->where('project_id', $project->id)->pluck('assignee_id')->unique()->all());
            foreach (Visibility::seeing($project, $assignees) as $person) {
                $seeing["{$project->id}:{$person->id}"] = true;
            }
        }

        return array_values($items->filter(fn (WorkItem $item) => isset($seeing["{$item->project_id}:{$item->assignee_id}"]))->all());
    }

    /**
     * The active people (no bots, no deactivated accounts).
     *
     * @return Builder<User>
     */
    private static function active(): Builder
    {
        return User::query()->where('type', AccountType::Person)->whereNull('disabled_at');
    }
}
