<?php

use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Actions\Notifications\PruneNotifications;
use App\Actions\Notifications\SaveNotificationPreferences;
use App\Actions\Notifications\SendDueReminders;
use App\Actions\Notifications\SendNotificationMail;
use App\Actions\Projects\RemoveMember;
use App\Domain\Notifications\NotificationKind;
use App\Domain\Workflow\StateCategory;
use App\Enums\Locale;
use App\Jobs\SendDueRemindersJob;
use App\Jobs\SendNotificationMailJob;
use App\Mail\NotificationDigest;
use App\Models\Notification;
use App\Models\NotificationMail;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use App\Support\Actor;
use Carbon\CarbonImmutable;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;

/*
 * The reminders "due" and "overdue" (Task 8, spec 4.14, A275): every hour the job reminds the people for whom it is
 * 08:xx, in their own time zone, of the open items assigned to them that are due today or overdue by their calendar.
 * The organization reads German in Europe/Berlin; WEB (public) with Tom as its admin, Mara (time zone of the
 * organization), Nina (New York) and Kiran (Kolkata) as members, OPS private with Tom and Ole. A mail server is set,
 * nothing leaves (Mail::fake), and the mail jobs wait (K2): a test sends itself.
 */

beforeEach(function () {
    config(['mail.default' => 'smtp', 'app.url' => 'https://werkbuch.example.com']);
    Mail::fake();
    Queue::fake([SendNotificationMailJob::class]);
    Organization::current()->update(['locale' => Locale::De, 'timezone' => 'Europe/Berlin']);
});

$world = function (): array {
    $tom = User::factory()->create(['name' => 'Tom', 'handle' => 'tom', 'email' => 'tom@example.com']);
    $web = Project::factory()->identifier('WEB')->public()->member($tom, ProjectRole::Admin)->create(['lead_id' => $tom->id]);
    $ops = Project::factory()->identifier('OPS')->private()->member($tom, ProjectRole::Admin)->create(['lead_id' => $tom->id]);
    $mara = memberOf($web, ProjectRole::Member, ['name' => 'Mara', 'handle' => 'mara', 'email' => 'mara@example.com']);
    $nina = memberOf($web, ProjectRole::Member, ['name' => 'Nina', 'handle' => 'nina', 'email' => 'nina@example.com', 'timezone' => 'America/New_York']);
    $kiran = memberOf($web, ProjectRole::Member, ['name' => 'Kiran', 'handle' => 'kiran', 'email' => 'kiran@example.com', 'timezone' => 'Asia/Kolkata']);
    $ole = memberOf($ops, ProjectRole::Member, ['name' => 'Ole', 'handle' => 'ole', 'email' => 'ole@example.com']);

    return compact('tom', 'web', 'ops', 'mara', 'nina', 'kiran', 'ole');
};

/** An open item of the project assigned to the person, due on the day. */
$due = fn (Project $project, User $assignee, string $day, string $title = 'Kontaktformular', array $attributes = []) => WorkItem::factory()->for($project)
    ->create(['assignee_id' => $assignee->id, 'due_date' => $day, 'title' => $title, 'created_by' => $assignee->id, ...$attributes]);

/** Runs the reminders for the hour it is now (UTC), as the job does. */
$remind = fn () => SendDueReminders::run(Actor::system(User::defaultBot(), 'due_reminders'), now()->utc()->startOfHour()->toImmutable());

/** The reminders of the person, oldest item first. */
$remindersOf = fn (User $user) => Notification::query()->where('user_id', $user->id)->where('kind', NotificationKind::Due)->orderBy('work_item_id')->get();

/** The one reminder collection of the person for the day. */
$collectionOf = fn (User $user, string $day) => NotificationMail::query()->where('user_id', $user->id)->where('scope', "due:{$day}")->sole();

it('reminds Mara at 08:00 in Berlin about an item due today and one overdue', function () use ($world, $due, $remind, $remindersOf) {
    $w = $world();
    $today = $due($w['web'], $w['mara'], '2026-11-03', 'Kontaktformular');
    $late = $due($w['web'], $w['mara'], '2026-10-30', 'Impressum');
    $due($w['web'], $w['mara'], '2026-11-04', 'Morgen');
    $due($w['web'], $w['mara'], '2026-11-03', 'Ohne Datum', ['due_date' => null]);

    // 07:59 in Berlin: nothing yet
    $this->travelTo(CarbonImmutable::parse('2026-11-03 06:59', 'UTC'));
    expect($remind())->toBe(0);

    $this->travelTo(CarbonImmutable::parse('2026-11-03 07:00', 'UTC'));
    expect($remind())->toBe(2);

    $reminders = $remindersOf($w['mara'])->keyBy('work_item_id');
    expect($reminders->keys()->sort()->values()->all())->toBe(collect([$today->id, $late->id])->sort()->values()->all())
        ->and($reminders[$today->id]->data)->toBe(['due_date' => '2026-11-03', 'overdue' => false])
        ->and($reminders[$late->id]->data)->toBe(['due_date' => '2026-10-30', 'overdue' => true])
        ->and($reminders[$today->id]->dedupe_key)->toBe("due:{$today->id}:2026-11-03")
        ->and($reminders[$today->id]->project_id)->toBe($w['web']->id)
        ->and($reminders[$today->id]->actor_id)->toBeNull()
        ->and($reminders[$today->id]->event_id)->toBeNull()
        ->and($reminders[$today->id]->inbox)->toBeTrue()
        ->and($reminders[$today->id]->read_at)->toBeNull();
    // Nina and Kiran are not at 08:00
    expect(Notification::query()->where('user_id', '!=', $w['mara']->id)->count())->toBe(0);
});

it('reminds a person in New York at her 08:00, not at Berlin\'s', function () use ($world, $due, $remind, $remindersOf) {
    $w = $world();
    $due($w['web'], $w['nina'], '2026-11-03');

    $this->travelTo(CarbonImmutable::parse('2026-11-03 07:00', 'UTC'));
    $remind();
    expect($remindersOf($w['nina']))->toBeEmpty();

    // 08:00 in New York (EST, UTC−5)
    $this->travelTo(CarbonImmutable::parse('2026-11-03 13:00', 'UTC'));
    $remind();
    expect($remindersOf($w['nina']))->toHaveCount(1)
        ->and($remindersOf($w['nina'])->sole()->data)->toBe(['due_date' => '2026-11-03', 'overdue' => false]);
});

it('reminds a person in Kolkata in the hour of 08:30', function () use ($world, $due, $remind, $remindersOf) {
    $w = $world();
    $due($w['web'], $w['kiran'], '2026-11-03');

    // 07:30 in Kolkata (UTC+05:30)
    $this->travelTo(CarbonImmutable::parse('2026-11-03 02:00', 'UTC'));
    $remind();
    expect($remindersOf($w['kiran']))->toBeEmpty();

    // 08:30 in Kolkata
    $this->travelTo(CarbonImmutable::parse('2026-11-03 03:00', 'UTC'));
    $remind();
    expect($remindersOf($w['kiran']))->toHaveCount(1)
        ->and($remindersOf($w['mara']))->toBeEmpty();
});

it('reminds on the day the clocks change', function () use ($world, $due, $remind, $remindersOf) {
    $w = $world();
    // Berlin turns back from CEST to CET on 2026-10-25, New York from EDT to EST on 2026-11-01
    $berlin = $due($w['web'], $w['mara'], '2026-10-25');
    $newYork = $due($w['web'], $w['nina'], '2026-11-01');

    // 06:00 UTC would have been 08:00 the day before, now it is 07:00
    $this->travelTo(CarbonImmutable::parse('2026-10-25 06:00', 'UTC'));
    $remind();
    expect($remindersOf($w['mara']))->toBeEmpty();
    $this->travelTo(CarbonImmutable::parse('2026-10-25 07:00', 'UTC'));
    $remind();
    expect($remindersOf($w['mara'])->pluck('work_item_id')->all())->toBe([$berlin->id]);

    $this->travelTo(CarbonImmutable::parse('2026-11-01 12:00', 'UTC'));
    $remind();
    expect($remindersOf($w['nina']))->toBeEmpty();
    $this->travelTo(CarbonImmutable::parse('2026-11-01 13:00', 'UTC'));
    $remind();
    expect($remindersOf($w['nina'])->pluck('work_item_id')->all())->toBe([$newYork->id]);
});

it('remembers the hour it was planned for, however late the job runs', function () use ($world, $due) {
    $w = $world();
    $due($w['web'], $w['mara'], '2026-11-03');
    $due($w['web'], $w['nina'], '2026-11-03');

    // the job of 07:00 UTC (08:00 in Berlin) waited on the queue until 13:00 UTC (08:00 in New York)
    $this->travelTo(CarbonImmutable::parse('2026-11-03 13:20', 'UTC'));
    (new SendDueRemindersJob(CarbonImmutable::parse('2026-11-03 07:00', 'UTC')))->handle();

    expect(Notification::query()->where('kind', NotificationKind::Due)->pluck('user_id')->all())->toBe([$w['mara']->id]);
});

it('reminds every day while the item is open, once per day although the job runs twice', function () use ($world, $due, $remind, $remindersOf) {
    $w = $world();
    $item = $due($w['web'], $w['mara'], '2026-11-03');

    $this->travelTo(CarbonImmutable::parse('2026-11-03 07:00', 'UTC'));
    expect($remind())->toBe(1);
    $this->travelTo(CarbonImmutable::parse('2026-11-03 07:40', 'UTC'));
    expect($remind())->toBe(0);

    expect($remindersOf($w['mara']))->toHaveCount(1)
        ->and(NotificationMail::query()->where('user_id', $w['mara']->id)->count())->toBe(1);
    Queue::assertPushed(SendNotificationMailJob::class, 1);

    $this->travelTo(CarbonImmutable::parse('2026-11-04 07:00', 'UTC'));
    expect($remind())->toBe(1);
    expect($remindersOf($w['mara'])->pluck('dedupe_key')->sort()->values()->all())
        ->toBe(["due:{$item->id}:2026-11-03", "due:{$item->id}:2026-11-04"])
        ->and($remindersOf($w['mara'])->firstWhere('dedupe_key', "due:{$item->id}:2026-11-04")->data)->toBe(['due_date' => '2026-11-03', 'overdue' => true]);
});

it('opens no second mail when the job runs again after the mail went', function () use ($world, $due, $remind, $collectionOf) {
    $w = $world();
    $due($w['web'], $w['mara'], '2026-11-03');
    $this->travelTo(CarbonImmutable::parse('2026-11-03 07:00', 'UTC'));
    $remind();
    SendNotificationMail::run(Actor::system(User::defaultBot(), 'notification_mail'), $collectionOf($w['mara'], '2026-11-03')->id);

    $this->travelTo(CarbonImmutable::parse('2026-11-03 07:30', 'UTC'));
    $remind();

    expect(NotificationMail::query()->where('user_id', $w['mara']->id)->count())->toBe(1);
    Mail::assertSent(NotificationDigest::class, 1);
});

it('keeps a mail-only reminder two days after its mail: a second run, also in a later zone, writes nothing (T8-M1)', function () use ($world, $due, $collectionOf) {
    $w = $world();
    SaveNotificationPreferences::run(actor($w['tom']), ['preferences' => [['event' => 'due', 'channel' => 'inbox', 'enabled' => false]]]);
    $due($w['ops'], $w['tom'], '2026-11-03');
    $at = fn (string $hour) => SendDueReminders::run(Actor::system(User::defaultBot(), 'due_reminders'), CarbonImmutable::parse($hour, 'UTC'));
    $prune = fn () => PruneNotifications::run(Actor::system(User::defaultBot(), 'prune_notifications'));
    $this->travelTo(CarbonImmutable::parse('2026-11-03 07:00', 'UTC'));
    expect($at('2026-11-03 07:00'))->toBe(1);
    SendNotificationMail::run(Actor::system(User::defaultBot(), 'notification_mail'), $collectionOf($w['tom'], '2026-11-03')->id);

    // an hour later: the row only for mail stays, so the job of 07:00 once more and Tom now in London (08:00 there,
    // the same day) find it and write nothing
    $this->travelTo(CarbonImmutable::parse('2026-11-03 08:10', 'UTC'));
    $prune();
    expect(Notification::query()->where('user_id', $w['tom']->id)->count())->toBe(1)
        ->and($at('2026-11-03 07:00'))->toBe(0);
    $w['tom']->update(['timezone' => 'Europe/London']);
    expect($at('2026-11-03 08:00'))->toBe(0)
        ->and(NotificationMail::query()->where('user_id', $w['tom']->id)->count())->toBe(1);
    Mail::assertSent(NotificationDigest::class, 1);

    // two days after the mail it goes
    $this->travelTo(CarbonImmutable::parse('2026-11-05 08:10', 'UTC'));
    $prune();
    expect(Notification::query()->where('user_id', $w['tom']->id)->count())->toBe(0);
});

it('reminds the other zones when one fails, and fails afterwards (T8-M2)', function () use ($world, $due, $remind, $remindersOf) {
    $w = $world();
    $due($w['web'], $w['mara'], '2026-11-03');
    // a zone that cannot be read (written around the validation), sorted before Berlin
    $lost = memberOf($w['web'], ProjectRole::Member, ['name' => 'Lost', 'timezone' => 'Atlantis/Nowhere']);
    $due($w['web'], $lost, '2026-11-03');
    $this->travelTo(CarbonImmutable::parse('2026-11-03 07:00', 'UTC'));

    expect(fn () => $remind())->toThrow(Exception::class);

    // Berlin got its reminder all the same; the job fails and is tried again, which writes nothing twice
    expect($remindersOf($w['mara']))->toHaveCount(1);
    expect(fn () => $remind())->toThrow(Exception::class);
    expect($remindersOf($w['mara']))->toHaveCount(1);
});

it('reminds nobody for an hour more than a day ago, e.g. a job taken back from failed_jobs', function () use ($world, $due) {
    $w = $world();
    $due($w['web'], $w['mara'], '2026-11-03');
    $this->travelTo(CarbonImmutable::parse('2026-11-05 07:00', 'UTC'));

    expect(SendDueReminders::run(Actor::system(User::defaultBot(), 'due_reminders'), CarbonImmutable::parse('2026-11-03 07:00', 'UTC')))->toBe(0)
        ->and(Notification::query()->where('kind', NotificationKind::Due)->count())->toBe(0);
    // within a day it still reminds (a job that waited)
    $this->travelTo(CarbonImmutable::parse('2026-11-04 06:59', 'UTC'));
    expect(SendDueReminders::run(Actor::system(User::defaultBot(), 'due_reminders'), CarbonImmutable::parse('2026-11-03 07:00', 'UTC')))->toBe(1);
});

it('does not remind about closed or archived items or items of archived projects', function () use ($world, $due, $remind, $remindersOf) {
    $w = $world();
    $archivedProject = Project::factory()->public()->archived()->member($w['mara'], ProjectRole::Member)->create();
    $deleting = Project::factory()->public()->member($w['mara'], ProjectRole::Member)->create();
    $open = $due($w['web'], $w['mara'], '2026-11-03', 'Offen');
    WorkItem::factory()->for($w['web'])->closed()->create(['assignee_id' => $w['mara']->id, 'due_date' => '2026-11-03']);
    WorkItem::factory()->for($w['web'])->inState('Cancelled')->create(['assignee_id' => $w['mara']->id, 'due_date' => '2026-11-03']);
    WorkItem::factory()->for($w['web'])->archived()->create(['assignee_id' => $w['mara']->id, 'due_date' => '2026-11-03']);
    $due($archivedProject, $w['mara'], '2026-11-03', 'Im Archiv');
    $due($deleting, $w['mara'], '2026-11-03', 'Wird gelöscht');
    $deleting->update(['deleting_at' => now()]);

    $this->travelTo(CarbonImmutable::parse('2026-11-03 07:00', 'UTC'));
    $remind();

    expect($remindersOf($w['mara'])->pluck('work_item_id')->all())->toBe([$open->id]);
});

it('does not remind a person without access or a bot assignee', function () use ($world, $due, $remind) {
    $w = $world();
    $kira = User::factory()->bot($w['tom'])->create(['name' => 'Kira', 'handle' => 'kira']);
    app(RoleAssignments::class)->setProjectRole($kira, $w['web'], ProjectRole::Member);
    $due($w['web'], $kira, '2026-11-03');
    $kept = $due($w['ops'], $w['ole'], '2026-11-03', 'Server umziehen');
    $lost = $due($w['ops'], $w['ole'], '2026-11-02', 'Backup prüfen');
    RemoveMember::run(actor($w['tom']), $w['ops'], $w['ole']);
    $kept->update(['assignee_id' => $w['tom']->id]);
    $gone = memberOf($w['web'], ProjectRole::Member, ['name' => 'Jonas', 'disabled_at' => now()]);
    $due($w['web'], $gone, '2026-11-03');

    $this->travelTo(CarbonImmutable::parse('2026-11-03 07:00', 'UTC'));
    $remind();

    // Ole no longer sees OPS: nothing about the item still assigned to him; Tom, its admin, is reminded of his
    expect(Notification::query()->where('kind', NotificationKind::Due)->get(['user_id', 'work_item_id'])->map(fn ($n) => [$n->user_id, $n->work_item_id])->all())
        ->toBe([[$w['tom']->id, $kept->id]])
        ->and($lost->fresh()->assignee_id)->toBe($w['ole']->id);
});

it('asks the same number of queries for two people and for many', function () use ($world, $due) {
    $w = $world();
    $private = Project::factory()->private()->member($w['tom'], ProjectRole::Admin)->create();
    $count = function (int $people) use ($w, $due, $private): int {
        Notification::query()->delete();
        NotificationMail::query()->delete();
        foreach (range(1, $people) as $n) {
            $person = memberOf($n % 2 === 0 ? $w['web'] : $private, ProjectRole::Member);
            $due($n % 2 === 0 ? $w['web'] : $private, $person, '2026-11-03');
            $due($w['ops'], $person, '2026-11-03');
        }
        DB::flushQueryLog();
        SendDueReminders::run(Actor::system(User::defaultBot(), 'due_reminders'), CarbonImmutable::parse('2026-11-03 07:00', 'UTC'));

        return count(DB::getQueryLog());
    };
    $this->travelTo(CarbonImmutable::parse('2026-11-03 07:00', 'UTC'));

    DB::enableQueryLog();
    $two = $count(2);
    $many = $count(10);
    DB::disableQueryLog();

    expect($many)->toBe($two)
        ->and(Notification::query()->where('kind', NotificationKind::Due)->count())->toBe(12);
});

it('sends one reminder mail per person and day', function () use ($world, $due, $remind, $collectionOf) {
    $w = $world();
    $due($w['web'], $w['mara'], '2026-11-03', 'Kontaktformular');
    $due($w['web'], $w['mara'], '2026-10-28', 'Impressum');
    $due($w['ops'], $w['tom'], '2026-11-03', 'Server umziehen');

    $this->travelTo(CarbonImmutable::parse('2026-11-03 07:00', 'UTC'));
    $remind();
    $mail = $collectionOf($w['mara'], '2026-11-03');

    // due after the delay like every collection (K10), its job after the commit
    expect($mail->due_at->equalTo(now()->addMinutes((int) config('werkbuch.notification_mail_delay'))))->toBeTrue()
        ->and(Notification::query()->where('user_id', $w['mara']->id)->pluck('mail_id')->unique()->all())->toBe([$mail->id]);
    Queue::assertPushed(SendNotificationMailJob::class, fn (SendNotificationMailJob $job) => $job->mailId === $mail->id);
    Queue::assertPushed(SendNotificationMailJob::class, 2);

    expect(SendNotificationMail::run(Actor::system(User::defaultBot(), 'notification_mail'), $mail->id))->toBe(NotificationMail::SENT);

    $digest = Mail::sent(NotificationDigest::class, fn (NotificationDigest $sent) => $sent->hasTo('mara@example.com'))->sole();
    expect($digest->locale)->toBe('de');
    $digest->assertHasSubject('Deine fälligen und überfälligen Items')
        // the oldest due date first
        ->assertSeeInOrderInHtml(['WEB-2', 'Impressum', 'Überfällig seit 28. Oktober 2026', 'WEB-1', 'Kontaktformular', 'Heute fällig'])
        ->assertSeeInHtml('https://werkbuch.example.com/items/WEB-2')
        ->assertSeeInHtml('https://werkbuch.example.com/my-items')
        ->assertSeeInOrderInText(['WEB-2 Impressum', 'Überfällig seit 28. Oktober 2026', 'https://werkbuch.example.com/items/WEB-2', 'WEB-1 Kontaktformular', 'Heute fällig'])
        ->assertDontSeeInHtml('Server umziehen');
});

it('leaves an item out of the reminder mail whose project the person lost before it went', function () use ($world, $due, $remind, $collectionOf) {
    $w = $world();
    app(RoleAssignments::class)->setProjectRole($w['mara'], $w['ops'], ProjectRole::Member);
    $due($w['web'], $w['mara'], '2026-11-03', 'Kontaktformular');
    $due($w['ops'], $w['mara'], '2026-11-03', 'Server umziehen');
    $this->travelTo(CarbonImmutable::parse('2026-11-03 07:00', 'UTC'));
    $remind();

    RemoveMember::run(actor($w['tom']), $w['ops'], $w['mara']);
    SendNotificationMail::run(Actor::system(User::defaultBot(), 'notification_mail'), $collectionOf($w['mara'], '2026-11-03')->id);

    Mail::sent(NotificationDigest::class)->sole()->assertSeeInHtml('Kontaktformular')
        ->assertDontSeeInHtml('Server umziehen')->assertDontSeeInHtml('OPS-1')->assertDontSeeInText('Server umziehen');
});

it('leaves an item out of the reminder mail that was closed, archived or given to someone else before it went (T8-M5)', function () use ($world, $due, $remind, $collectionOf) {
    $w = $world();
    $open = $due($w['web'], $w['mara'], '2026-11-03', 'Kontaktformular');
    $closed = $due($w['web'], $w['mara'], '2026-11-03', 'Impressum');
    $archived = $due($w['web'], $w['mara'], '2026-11-03', 'Footer');
    $given = $due($w['web'], $w['mara'], '2026-11-03', 'Datenschutz');
    $this->travelTo(CarbonImmutable::parse('2026-11-03 07:00', 'UTC'));
    $remind();

    // between 08:00 and the mail: one is done, one archived (done first), one assigned to Nina
    $done = $w['web']->workflow->states->firstWhere('category', StateCategory::Completed);
    $closed->update(['state_id' => $done->id]);
    $archived->update(['state_id' => $done->id, 'archived_at' => now()]);
    $given->update(['assignee_id' => $w['nina']->id]);
    SendNotificationMail::run(Actor::system(User::defaultBot(), 'notification_mail'), $collectionOf($w['mara'], '2026-11-03')->id);

    Mail::sent(NotificationDigest::class)->sole()->assertSeeInHtml($open->title)
        ->assertDontSeeInHtml('Impressum')->assertDontSeeInHtml('Footer')->assertDontSeeInHtml('Datenschutz');

    // nothing left: skipped
    $item = $due($w['web'], $w['tom'], '2026-11-03', 'Server');
    $this->travelTo(CarbonImmutable::parse('2026-11-04 07:00', 'UTC'));
    $remind();
    $item->update(['state_id' => $done->id]);
    $w['web']->update(['archived_at' => now()]);
    expect(SendNotificationMail::run(Actor::system(User::defaultBot(), 'notification_mail'), $collectionOf($w['tom'], '2026-11-04')->id))->toBe(NotificationMail::SKIPPED);
});

it('writes the reminder mail in the language of the person', function () use ($world, $due, $remind, $collectionOf) {
    $w = $world();
    $w['nina']->update(['locale' => Locale::En]);
    $due($w['web'], $w['nina'], '2026-11-02', 'Contact form');
    $this->travelTo(CarbonImmutable::parse('2026-11-03 13:00', 'UTC'));
    $remind();

    SendNotificationMail::run(Actor::system(User::defaultBot(), 'notification_mail'), $collectionOf($w['nina'], '2026-11-03')->id);

    Mail::sent(NotificationDigest::class)->sole()
        ->assertHasSubject('Your due and overdue items')
        ->assertSeeInHtml('Overdue since November 2, 2026')
        ->assertSeeInText('Open my items');
});

it('follows the reminder preferences', function () use ($world, $due, $remind, $remindersOf) {
    $w = $world();
    $set = fn (User $user, bool $inbox, bool $mail) => SaveNotificationPreferences::run(actor($user), ['preferences' => [
        ['event' => 'due', 'channel' => 'inbox', 'enabled' => $inbox], ['event' => 'due', 'channel' => 'mail', 'enabled' => $mail],
    ]]);
    $tomsItem = $due($w['ops'], $w['tom'], '2026-11-03');
    $due($w['web'], $w['mara'], '2026-11-03');
    $olesItem = $due($w['ops'], $w['ole'], '2026-11-03');
    $set($w['tom'], inbox: false, mail: true);
    $set($w['mara'], inbox: false, mail: false);
    $set($w['ole'], inbox: true, mail: false);

    $this->travelTo(CarbonImmutable::parse('2026-11-03 07:00', 'UTC'));
    $remind();

    // Tom only by mail (A271), Mara not at all, Ole only in the inbox
    expect($remindersOf($w['tom'])->sole()->only(['work_item_id', 'inbox']))->toBe(['work_item_id' => $tomsItem->id, 'inbox' => false])
        ->and($remindersOf($w['tom'])->sole()->mail_id)->not->toBeNull()
        ->and($remindersOf($w['mara']))->toBeEmpty()
        ->and($remindersOf($w['ole'])->sole()->only(['work_item_id', 'inbox', 'mail_id']))->toBe(['work_item_id' => $olesItem->id, 'inbox' => true, 'mail_id' => null])
        ->and(NotificationMail::query()->pluck('user_id')->all())->toBe([$w['tom']->id]);
});

it('opens no mail and writes no mail-only reminder without a mail server', function () use ($world, $due, $remind, $remindersOf) {
    $w = $world();
    config(['mail.default' => 'array']);
    SaveNotificationPreferences::run(actor($w['tom']), ['preferences' => [['event' => 'due', 'channel' => 'inbox', 'enabled' => false]]]);
    $due($w['web'], $w['mara'], '2026-11-03');
    $due($w['ops'], $w['tom'], '2026-11-03');

    $this->travelTo(CarbonImmutable::parse('2026-11-03 07:00', 'UTC'));
    $remind();

    // mail counts as off (K9): Mara in the inbox only, Tom (inbox off) not at all
    expect($remindersOf($w['mara'])->sole()->mail_id)->toBeNull()
        ->and($remindersOf($w['tom']))->toBeEmpty()
        ->and(NotificationMail::query()->count())->toBe(0);
});

it('reminds every hour from its job on the queue notifications, for the hour it was planned in', function () use ($world, $due, $remindersOf) {
    $w = $world();
    $due($w['web'], $w['mara'], '2026-11-03');
    $task = collect(app(Schedule::class)->events())->sole(fn ($event) => $event->description === SendDueRemindersJob::class);
    $job = new SendDueRemindersJob(CarbonImmutable::parse('2026-11-03 07:00', 'UTC'));
    // the job runs within its hour: an hour more than a day back is skipped (F3), so the clock must not be today's
    $this->travelTo(CarbonImmutable::parse('2026-11-03 07:00:05', 'UTC'));

    $job->handle();

    expect($task->expression)->toBe('0 * * * *')
        ->and($task->withoutOverlapping)->toBeTrue()
        ->and($task->expiresAt)->toBe(60)
        ->and($job->queue)->toBe('notifications')
        ->and($remindersOf($w['mara']))->toHaveCount(1);
});
