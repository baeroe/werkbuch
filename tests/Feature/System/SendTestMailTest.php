<?php

use App\Actions\System\SendTestMail;
use App\Enums\Locale;
use App\Exceptions\Problem;
use App\Models\Event;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Support\Facades\Exceptions;
use Symfony\Component\Mailer\Exception\TransportException;
use Symfony\Component\Mailer\SentMessage;
use Symfony\Component\Mime\Email;
use Tests\Support\ScriptedTransport;

/*
 * The test mail of the system page (Task 11, A287): sent at once to the org admin who asks, in their language, so the
 * page can show a refusing mail server right away; nothing is written.
 */

beforeEach(function () {
    Organization::current()->update(['locale' => Locale::De, 'name' => 'Feldwerk']);
    $this->admin = User::factory()->admin()->locale(Locale::En)->create(['name' => 'Erik Ende', 'email' => 'erik@example.com']);
});

it('sends the test mail to the admin in their language', function () {
    $sent = [];
    $transport = ScriptedTransport::use(function (int $n, SentMessage $message) use (&$sent) {
        $sent[] = $message->getOriginalMessage();
    });
    $events = Event::query()->count();
    app()->setLocale('de');   // the request reads German, the admin English

    expect(SendTestMail::run(actor($this->admin)))->toBe('erik@example.com')
        ->and($transport->count())->toBe(1)
        ->and(Event::query()->count())->toBe($events);

    /** @var Email $mail */
    $mail = $sent[0];
    expect($mail->getTo()[0]->getAddress())->toBe('erik@example.com')
        ->and($mail->getSubject())->toBe(__('mail.test.subject', [], 'en'))
        ->and($mail->getTextBody())->toContain(__('mail.test.heading', [], 'en'))
        ->toContain(__('mail.test.body', ['name' => 'Erik Ende', 'organization' => 'Feldwerk'], 'en'))
        ->and($mail->getHtmlBody())->toContain('lang="en"')->toContain(e(__('mail.test.heading', [], 'en')))
        // the request goes on in its own language
        ->and(app()->getLocale())->toBe('de');
});

it('answers 409 without a mail server', function () {
    config(['mail.default' => 'log']);

    expect(fn () => SendTestMail::run(actor($this->admin)))->toThrow(function (Problem $problem) {
        expect($problem->status)->toBe(409)->and($problem->reason)->toBe('mail_not_configured');
    });
});

it('answers 503 when the server refuses', function () {
    Exceptions::fake();
    ScriptedTransport::use(fn () => throw new TransportException('550 Mailbox unavailable'));

    expect(fn () => SendTestMail::run(actor($this->admin)))->toThrow(function (Problem $problem) {
        expect($problem->status)->toBe(503)->and($problem->reason)->toBe('mail_failed');
    });

    Exceptions::assertReported(fn (TransportException $e) => $e->getMessage() === '550 Mailbox unavailable');
});

it('refuses members and bots with 403 before it looks at the mail server', function () {
    $transport = ScriptedTransport::use(fn () => null);

    foreach ([User::factory()->create(), User::defaultBot()] as $account) {
        expect(fn () => SendTestMail::run(actor($account)))->toThrow(Problem::class, __('problem.detail.system_admins_only'));
    }

    expect($transport->count())->toBe(0);
});
