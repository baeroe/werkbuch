<?php

use App\Access\OrgRole;
use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Actions\Comments\AddComment;
use App\Actions\Notifications\MarkNotificationsRead;
use App\Actions\Notifications\SaveNotificationPreferences;
use App\Actions\Notifications\SendNotificationMail;
use App\Actions\Projects\RemoveMember;
use App\Actions\Projects\UpdateProject;
use App\Actions\Users\DeactivateUser;
use App\Actions\Users\UpdateUserRole;
use App\Actions\WorkItems\SetSubscription;
use App\Actions\WorkItems\TransitionWorkItem;
use App\Actions\WorkItems\UpdateWorkItem;
use App\Domain\Notifications\NotificationKind;
use App\Enums\Locale;
use App\Jobs\SendNotificationMailJob;
use App\Mail\NotificationDigest;
use App\Models\Attachment;
use App\Models\Comment;
use App\Models\Notification;
use App\Models\NotificationMail;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use App\Notifications\NotificationConsumer;
use App\Support\Actor;
use Illuminate\Mail\MailManager;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Symfony\Component\Mailer\Exception\TransportException;
use Symfony\Component\Mailer\SentMessage;
use Symfony\Component\Mailer\Transport\AbstractTransport;
use Tests\Support\RichTextFixtures as F;

/*
 * The digest mail of a person and an item (Task 7): the consumer `notifications` collects the lines, SendNotificationMail
 * sends them once they are due, and decides only then who still sees what (Review Focus 3). WEB (public) with Tom as
 * its admin and lead, Mara, Ida and Jonas as members; OPS is private with Tom as its lead and Ole as a member; Lena is
 * an org admin and member of nothing. The organization reads German in Europe/Berlin. A mail server is set, nothing leaves (Mail::fake), and the jobs wait (K2): the
 * tests send themselves, after the change they look at.
 */

beforeEach(function () {
    consumers(NotificationConsumer::class);
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
    $ida = memberOf($web, ProjectRole::Member, ['name' => 'Ida', 'handle' => 'ida', 'email' => 'ida@example.com']);
    $jonas = memberOf($web, ProjectRole::Member, ['name' => 'Jonas', 'handle' => 'jonas', 'email' => 'jonas@example.com']);
    $ole = memberOf($ops, ProjectRole::Member, ['name' => 'Ole', 'handle' => 'ole', 'email' => 'ole@example.com']);
    $lena = User::factory()->admin()->create(['name' => 'Lena', 'handle' => 'lena', 'email' => 'lena@example.com']);
    $item = WorkItem::factory()->for($web)->create(['created_by' => $tom->id, 'title' => 'Kontaktformular']);
    $opsItem = WorkItem::factory()->for($ops)->create(['created_by' => $tom->id, 'title' => 'Server umziehen']);

    return compact('tom', 'web', 'ops', 'mara', 'ida', 'jonas', 'ole', 'lena', 'item', 'opsItem');
};

$watch = fn (User $user, WorkItem $item) => SetSubscription::run(actor($user), $item, true);

/** The one open collection of the person for the item. */
$collection = fn (User $user, WorkItem $item) => NotificationMail::query()->where('user_id', $user->id)->where('scope', "item:{$item->id}")->sole();

$send = fn (NotificationMail $mail) => SendNotificationMail::run(Actor::system(User::defaultBot(), 'notification_mail'), $mail->id);

/** The digests that went to the address. */
$mailsTo = fn (User $user) => Mail::sent(NotificationDigest::class, fn (NotificationDigest $mail) => $mail->hasTo($user->email));

it('sends one mail with every unread notification of the item', function () use ($world, $watch, $collection, $send, $mailsTo) {
    $w = $world();
    $watch($w['mara'], $w['item']);
    AddComment::run(actor($w['ida']), $w['item'], ['body' => 'Das Formular ist live.']);
    AddComment::run(actor($w['jonas']), $w['item'], ['body' => 'Die Validierung fehlt noch.']);
    $mail = $collection($w['mara'], $w['item']);

    expect($send($mail))->toBe(NotificationMail::SENT);

    $mail->refresh();
    $digest = $mailsTo($w['mara'])->sole();
    expect($mail->outcome)->toBe(NotificationMail::SENT)
        ->and($mail->sent_at)->not->toBeNull()
        ->and($mail->open_key)->toBeNull()
        ->and($digest->locale)->toBe('de');
    $digest->assertHasSubject('[WEB-1] Kontaktformular')
        ->assertSeeInOrderInHtml(['Ida hat kommentiert', 'Das Formular ist live.', 'Jonas hat kommentiert', 'Die Validierung fehlt noch.'])
        ->assertSeeInOrderInText(['Ida hat kommentiert', 'Das Formular ist live.', 'Jonas hat kommentiert', 'Die Validierung fehlt noch.']);
    // Tom, the lead, gets his own mail; nobody else
    expect($mailsTo($w['tom']))->toBeEmpty();
    $send($collection($w['tom'], $w['item']));
    expect($mailsTo($w['tom']))->toHaveCount(1)
        ->and(Mail::sent(NotificationDigest::class))->toHaveCount(2);
});

it('sends nothing once every notification is read, and marks the collection skipped', function () use ($world, $watch, $collection, $send) {
    $w = $world();
    $watch($w['mara'], $w['item']);
    AddComment::run(actor($w['ida']), $w['item'], ['body' => 'Das Formular ist live.']);
    MarkNotificationsRead::run(actor($w['mara']), ['all' => true]);
    $mail = $collection($w['mara'], $w['item']);

    expect($send($mail))->toBe(NotificationMail::SKIPPED);

    $mail->refresh();
    Mail::assertNothingSent();
    // closed like a sent one (K8): the sweeper leaves it alone, and the next line opens a new collection
    expect($mail->outcome)->toBe(NotificationMail::SKIPPED)
        ->and($mail->sent_at)->not->toBeNull()
        ->and($mail->open_key)->toBeNull();
});

it('leaves out what is read and sends the rest', function () use ($world, $watch, $collection, $send) {
    $w = $world();
    $watch($w['mara'], $w['item']);
    AddComment::run(actor($w['ida']), $w['item'], ['body' => 'Schon gelesen.']);
    AddComment::run(actor($w['jonas']), $w['item'], ['body' => 'Noch neu.']);
    $read = Notification::query()->where('user_id', $w['mara']->id)->orderBy('created_at')->firstOrFail();
    MarkNotificationsRead::run(actor($w['mara']), ['ids' => [$read->id]]);

    $send($collection($w['mara'], $w['item']));

    Mail::sent(NotificationDigest::class)->sole()->assertSeeInHtml('Noch neu.')->assertDontSeeInHtml('Schon gelesen.');
});

it('leaves out a person who lost the project before the mail', function () use ($world, $watch, $collection, $send) {
    $w = $world();
    $watch($w['ole'], $w['opsItem']);
    AddComment::run(actor($w['tom']), $w['opsItem'], ['body' => 'Der Server zieht heute um.']);
    $mail = $collection($w['ole'], $w['opsItem']);

    RemoveMember::run(actor($w['tom']), $w['ops'], $w['ole']);

    expect($send($mail))->toBe(NotificationMail::SKIPPED);
    Mail::assertNothingSent();
});

it('leaves out a deactivated person', function () use ($world, $watch, $collection, $send) {
    $w = $world();
    $watch($w['mara'], $w['item']);
    AddComment::run(actor($w['ida']), $w['item'], ['body' => 'Das Formular ist live.']);
    $mail = $collection($w['mara'], $w['item']);

    DeactivateUser::run(actor($w['lena']), $w['mara']);

    expect($send($mail))->toBe(NotificationMail::SKIPPED);
    Mail::assertNothingSent();
});

it('leaves out a person whose public project was made private', function () use ($world, $watch, $collection, $send) {
    $w = $world();
    // Ole reads WEB only because it is public
    $watch($w['ole'], $w['item']);
    AddComment::run(actor($w['ida']), $w['item'], ['body' => 'Das Formular ist live.']);
    $mail = $collection($w['ole'], $w['item']);

    UpdateProject::run(actor($w['tom']), $w['web'], ['visibility' => 'private']);

    expect($send($mail))->toBe(NotificationMail::SKIPPED);
    Mail::assertNothingSent();
});

it('leaves out an org admin who became a member', function () use ($world, $watch, $collection, $send) {
    $w = $world();
    // Lena reads OPS only as an org admin
    $watch($w['lena'], $w['opsItem']);
    AddComment::run(actor($w['tom']), $w['opsItem'], ['body' => 'Der Server zieht heute um.']);
    $mail = $collection($w['lena'], $w['opsItem']);

    UpdateUserRole::run(actor(User::factory()->admin()->create()), $w['lena'], OrgRole::Member);

    expect($send($mail))->toBe(NotificationMail::SKIPPED);
    Mail::assertNothingSent();
});

it('leaves out a kind whose mail was switched off meanwhile', function () use ($world, $watch, $collection, $send) {
    $w = $world();
    $watch($w['mara'], $w['item']);
    AddComment::run(actor($w['ida']), $w['item'], ['body' => 'Ein Kommentar.']);
    AddComment::run(actor($w['jonas']), $w['item'], ['body' => '@mara, bitte prüfen.']);

    SaveNotificationPreferences::run(actor($w['mara']), ['preferences' => [['event' => 'comment', 'channel' => 'mail', 'enabled' => false]]]);
    $send($collection($w['mara'], $w['item']));

    Mail::sent(NotificationDigest::class)->sole()->assertSeeInHtml('Jonas hat dich erwähnt')->assertDontSeeInHtml('Ein Kommentar.');
});

it('sends a collection only once, even when its job runs twice', function () use ($world, $watch, $collection, $send) {
    $w = $world();
    $watch($w['mara'], $w['item']);
    AddComment::run(actor($w['ida']), $w['item'], ['body' => 'Das Formular ist live.']);
    $mail = $collection($w['mara'], $w['item']);

    expect($send($mail))->toBe(NotificationMail::SENT)
        ->and($send($mail))->toBe(SendNotificationMail::ALREADY)
        // the job of a collection that is gone (pruned) does nothing either
        ->and(SendNotificationMail::run(Actor::system(User::defaultBot(), 'notification_mail'), (string) Str::ulid()))->toBe(SendNotificationMail::ALREADY);
    Mail::assertSentCount(1);
});

it('keeps the collection open when SMTP fails, and sends it on the next try', function () use ($world, $watch, $collection, $send) {
    $w = $world();
    $watch($w['mara'], $w['item']);
    AddComment::run(actor($w['ida']), $w['item'], ['body' => 'Das Formular ist live.']);
    $mail = $collection($w['mara'], $w['item']);
    // a mail server that refuses the first mail and keeps every attempt
    $attempts = new ArrayObject;
    Mail::swap($manager = new MailManager(app()));
    $manager->extend('refusing', fn () => new class($attempts) extends AbstractTransport
    {
        public function __construct(private readonly ArrayObject $attempts)
        {
            parent::__construct();
        }

        protected function doSend(SentMessage $message): void
        {
            $this->attempts->append($message);
            if ($this->attempts->count() === 1) {
                throw new TransportException('Connection could not be established.');
            }
        }

        public function __toString(): string
        {
            return 'refusing://';
        }
    });
    config(['mail.mailers.refusing' => ['transport' => 'refusing'], 'mail.default' => 'refusing']);

    expect(fn () => $send($mail))->toThrow(TransportException::class);
    $mail->refresh();
    expect($mail->sent_at)->toBeNull()
        ->and($mail->outcome)->toBeNull()
        ->and($mail->open_key)->toBe("{$w['mara']->id}:item:{$w['item']->id}");

    expect($send($mail))->toBe(NotificationMail::SENT)
        ->and($attempts)->toHaveCount(2);
});

it('writes the mail in the person\'s language and time zone with the link to the item and to the settings', function () use ($world, $watch, $collection, $send) {
    $w = $world();
    $w['mara']->update(['locale' => Locale::En, 'timezone' => 'America/New_York']);
    $watch($w['mara'], $w['item']);
    $this->travelTo(Carbon::parse('2026-11-03 14:30:00', 'UTC'));
    AddComment::run(actor($w['ida']), $w['item'], ['body' => 'Das Formular ist live.']);
    $doing = $w['web']->workflow->states()->where('name', 'In Progress')->firstOrFail();
    TransitionWorkItem::run(actor($w['jonas']), $w['item'], ['to_state_id' => $doing->id]);
    UpdateWorkItem::run(actor($w['jonas']), $w['item'], ['title' => 'Kontaktformular v2', 'assignee_id' => $w['mara']->id]);

    $send($collection($w['mara'], $w['item']));

    $digest = Mail::sent(NotificationDigest::class)->sole();
    expect($digest->locale)->toBe('en');
    $digest->assertHasSubject('[WEB-1] Kontaktformular v2')
        // 09:30 in New York, the time of the person; the sentences in English
        ->assertSeeInHtml('Ida commented')->assertSeeInHtml('November 3, 2026 9:30 AM')
        ->assertSeeInHtml('Jonas assigned the item to you')
        ->assertSeeInHtml('https://werkbuch.example.com/items/WEB-1', false)
        ->assertSeeInHtml('https://werkbuch.example.com/me/notifications', false)
        ->assertSeeInText('https://werkbuch.example.com/items/WEB-1')
        ->assertSeeInText('https://werkbuch.example.com/me/notifications');
    // the state and the change of the title are not mailed by default
    $digest->assertDontSeeInHtml('In Progress');

    // Tom reads German, in the time zone of the organization (Europe/Berlin)
    $send($collection($w['tom'], $w['item']));
    Mail::sent(NotificationDigest::class, fn (NotificationDigest $mail) => $mail->hasTo('tom@example.com'))->sole()
        ->assertSeeInHtml('Ida hat kommentiert')->assertSeeInHtml('15:30');
});

it('names somebody who is gone as someone, and the states of a move', function () use ($world, $send) {
    $w = $world();
    // both kinds go by mail only when chosen
    SaveNotificationPreferences::run(actor($w['mara']), ['preferences' => [
        ['event' => 'state_changed', 'channel' => 'mail', 'enabled' => true], ['event' => 'item_created', 'channel' => 'mail', 'enabled' => true],
    ]]);
    $mail = NotificationMail::factory()->create(['user_id' => $w['mara']->id, 'scope' => "item:{$w['item']->id}", 'open_key' => "{$w['mara']->id}:item:{$w['item']->id}"]);
    Notification::factory()->forItem($w['item'])->kind(NotificationKind::StateChanged, ['from' => ['id' => 'a', 'name' => 'Todo', 'category' => 'unstarted'], 'to' => ['id' => 'b', 'name' => 'Done', 'category' => 'completed']])
        ->create(['user_id' => $w['mara']->id, 'mail_id' => $mail->id, 'actor_id' => $w['jonas']->id]);
    Notification::factory()->forItem($w['item'])->kind(NotificationKind::ItemCreated)->create(['user_id' => $w['mara']->id, 'mail_id' => $mail->id]);

    $send($mail);

    Mail::sent(NotificationDigest::class)->sole()
        ->assertSeeInHtml('Jonas hat den Status von Todo auf Done gesetzt')
        ->assertSeeInHtml('Jemand hat das Item angelegt');
});

it('shows Ida no key of an item she cannot see in the comment text', function () use ($world, $watch, $collection, $send) {
    $w = $world();
    $watch($w['ida'], $w['item']);
    $watch($w['mara'], $w['item']);
    app(RoleAssignments::class)->setProjectRole($w['mara'], $w['ops'], ProjectRole::Member);
    AddComment::run(actor($w['tom']), $w['item'], ['body_json' => F::doc(F::p('Hängt an ', F::reference($w['opsItem']->id), '.'))]);

    $send($collection($w['ida'], $w['item']));
    $send($collection($w['mara'], $w['item']));

    $ida = Mail::sent(NotificationDigest::class, fn (NotificationDigest $mail) => $mail->hasTo('ida@example.com'))->sole();
    $ida->assertDontSeeInHtml('OPS-1')->assertDontSeeInHtml('Server umziehen')->assertSeeInHtml(__('richtext.hidden', [], 'de'))
        ->assertDontSeeInText('OPS-1')->assertDontSeeInText('Server umziehen');
    Mail::sent(NotificationDigest::class, fn (NotificationDigest $mail) => $mail->hasTo('mara@example.com'))->sole()
        ->assertSeeInHtml('OPS-1 Server umziehen')->assertSeeInHtml('https://werkbuch.example.com/items/OPS-1', false);
});

it('quotes the description a mention stands in, and nothing of a deleted comment', function () use ($world, $send) {
    $w = $world();
    $w['item']->update(['description' => F::doc(F::p('Frag ', F::mention($w['mara']->id, 'mara'), ' nach dem Layout.'))]);
    $mail = NotificationMail::factory()->create(['user_id' => $w['mara']->id, 'scope' => "item:{$w['item']->id}", 'open_key' => "{$w['mara']->id}:item:{$w['item']->id}"]);
    Notification::factory()->forItem($w['item'])->kind(NotificationKind::Mentioned, ['source' => 'description'])->create(['user_id' => $w['mara']->id, 'mail_id' => $mail->id, 'actor_id' => $w['ida']->id]);
    Notification::factory()->forItem($w['item'])->kind(NotificationKind::Comment, ['comment_id' => (string) Str::ulid()])->create(['user_id' => $w['mara']->id, 'mail_id' => $mail->id, 'actor_id' => $w['jonas']->id]);

    $send($mail);

    Mail::sent(NotificationDigest::class)->sole()
        ->assertSeeInOrderInHtml(['Ida hat dich erwähnt', 'Frag @Mara nach dem Layout.', 'Jonas hat kommentiert'])
        ->assertSeeInText('Frag @Mara nach dem Layout.');
});

it('cuts a long text after 2000 characters and links to the item', function () use ($world, $watch, $collection, $send) {
    $w = $world();
    $watch($w['mara'], $w['item']);
    AddComment::run(actor($w['ida']), $w['item'], ['body' => str_repeat('a', 1990).' **'.str_repeat('b', 20).'** Ende']);

    $send($collection($w['mara'], $w['item']));

    $digest = Mail::sent(NotificationDigest::class)->sole();
    $digest->assertSeeInHtml(str_repeat('a', 1990).' '.str_repeat('b', 9).'…')
        ->assertDontSeeInHtml('Ende')->assertDontSeeInHtml('<strong>', false)
        ->assertSeeInHtml('Weiterlesen')
        ->assertSeeInText(str_repeat('b', 9).'…')->assertDontSeeInText('Ende');
});

it('sends no attachment and no embedded image', function () use ($world, $send) {
    $w = $world();
    $image = Attachment::factory()->create(['filename' => 'skizze.png']);
    $comment = Comment::factory()->for($w['item'], 'workItem')->create([
        'author_id' => $w['ida']->id,
        'body' => F::doc(F::p('Skizze anbei.'), F::image($image->id, 'Skizze'), F::p(F::file($image->id, 'skizze.png'))),
    ]);
    $mail = NotificationMail::factory()->create(['user_id' => $w['mara']->id, 'scope' => "item:{$w['item']->id}", 'open_key' => "{$w['mara']->id}:item:{$w['item']->id}"]);
    Notification::factory()->forItem($w['item'])->kind(NotificationKind::Comment, ['comment_id' => $comment->id])->create(['user_id' => $w['mara']->id, 'mail_id' => $mail->id, 'actor_id' => $w['ida']->id]);

    $send($mail);

    $digest = Mail::sent(NotificationDigest::class)->sole();
    $digest->assertDontSeeInHtml('<img', false)->assertDontSeeInHtml('cid:', false)
        ->assertSeeInHtml("https://werkbuch.example.com/attachments/{$image->id}", false);
    // after rendering, as the mailer would see it
    expect($digest->attachments)->toBe([])
        ->and($digest->rawAttachments)->toBe([])
        ->and($digest->diskAttachments)->toBe([]);
});

it('opens a new collection for a notification that arrives after the send', function () use ($world, $watch, $collection, $send) {
    $w = $world();
    $watch($w['mara'], $w['item']);
    AddComment::run(actor($w['ida']), $w['item'], ['body' => 'Vor dem Senden.']);
    $first = $collection($w['mara'], $w['item']);
    $send($first);

    AddComment::run(actor($w['ida']), $w['item'], ['body' => 'Nach dem Senden.']);

    $mails = NotificationMail::query()->where('user_id', $w['mara']->id)->orderBy('created_at')->orderBy('id')->get();
    $second = $mails->firstWhere('id', '!=', $first->id);
    expect($mails)->toHaveCount(2)
        ->and($second?->sent_at)->toBeNull()
        ->and($second?->open_key)->toBe("{$w['mara']->id}:item:{$w['item']->id}")
        ->and(Notification::query()->where('mail_id', $first->id)->count())->toBe(1)
        ->and(Notification::query()->where('mail_id', $second?->id)->count())->toBe(1);
    Queue::assertPushed(SendNotificationMailJob::class, fn (SendNotificationMailJob $job) => $job->mailId === $second?->id);
});

it('sends the collection from its job on the queue notifications, with five tries', function () use ($world, $watch, $collection) {
    $w = $world();
    $watch($w['mara'], $w['item']);
    AddComment::run(actor($w['ida']), $w['item'], ['body' => 'Das Formular ist live.']);
    $job = new SendNotificationMailJob($collection($w['mara'], $w['item'])->id);

    $job->handle();

    expect($job->queue)->toBe('notifications')
        ->and($job->tries)->toBe(5)
        ->and($job->backoff)->toBe([60, 300, 900, 3600])
        ->and($collection($w['mara'], $w['item'])->outcome)->toBe(NotificationMail::SENT);
    Mail::assertSent(NotificationDigest::class, 1);
});
