<?php

use App\Access\ProjectRole;
use App\Jobs\SendNotificationMailJob;
use App\Mail\NotificationDigest;
use App\Models\NotificationMail;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use App\Notifications\NotificationConsumer;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;

/*
 * The acceptance of phase 8 over REST (success criterion 2.4 "in REST"): a token of Ida comments with `@mara` in
 * Markdown, the consumer `notifications` tells Mara, who reads her inbox and marks the mention read over the API; the
 * mail of a read mention never goes out, the next unread one does, once. The mail job is held (K2: the sync queue would
 * send it before Mara reads), the collections go out through `app:send-notification-mails --now`.
 */

$world = function (): array {
    // Ida leads WEB, so her own comment tells nobody but Mara; a mail server (K2: the array mailer counts as none, and without one no collection opens)
    config(['mail.default' => 'smtp']);
    Mail::fake();
    Queue::fake([SendNotificationMailJob::class]);
    consumers(NotificationConsumer::class);

    $ida = User::factory()->create(['name' => 'Ida', 'handle' => 'ida']);
    $web = Project::factory()->identifier('WEB')->member($ida, ProjectRole::Admin)->create(['lead_id' => $ida->id]);
    $mara = memberOf($web, ProjectRole::Member, ['name' => 'Mara', 'handle' => 'mara', 'locale' => 'en']);

    return ['ida' => $ida, 'mara' => $mara, 'item' => WorkItem::factory()->for($web)->create(['title' => 'Kontaktformular'])];
};

it('mentions Mara over REST: her inbox has it, a read mention mails nothing, the next unread one once', function () use ($world) {
    $w = $world();
    $ida = apiToken($w['ida'], ['read', 'write']);
    $mara = apiToken($w['mara'], ['read', 'write']);
    $key = $w['item']->key;

    $this->withToken($ida)->postJson("/api/v1/work-items/{$key}/comments", ['body' => '@mara schaust du kurz drauf?'])->assertCreated();

    forgetApiAuth();
    $inbox = $this->withToken($mara)->getJson('/api/v1/notifications')->assertOk()
        ->assertJsonPath('meta.total', 1)
        ->assertJsonPath('data.0.event', 'mentioned')
        ->assertJsonPath('data.0.actor_id', $w['ida']->id)
        ->assertJsonPath('data.0.work_item_id', $w['item']->id)
        ->assertJsonPath('data.0.data.source', 'comment')
        ->assertJsonPath('data.0.excerpt', '@Mara schaust du kurz drauf?')
        ->assertJsonPath('data.0.read_at', null)
        ->assertJsonPath('data.0.mailed_at', null)
        ->assertJsonPath('data.0.item.key', $key);
    $this->getJson('/api/v1/notifications?mentions_only=1&unread_only=1')->assertJsonPath('meta.total', 1);

    // read over the API before the mail went: the collection is skipped, no mail
    $this->postJson('/api/v1/notifications/read', ['ids' => [$inbox->json('data.0.id')]])->assertOk()->assertExactJson(['updated' => 1]);
    $this->getJson('/api/v1/notifications?unread_only=1')->assertJsonPath('meta.total', 0);

    $this->artisan('app:send-notification-mails', ['--now' => true])->assertSuccessful();
    Mail::assertNothingSent();
    expect(NotificationMail::query()->sole()->outcome)->toBe(NotificationMail::SKIPPED);

    // a second mention, unread: a collection of its own, and exactly one mail
    forgetApiAuth();
    $this->withToken($ida)->postJson("/api/v1/work-items/{$key}/comments", ['body' => '@mara und der Footer?'])->assertCreated();
    forgetApiAuth();
    $this->withToken($mara)->getJson('/api/v1/notifications?unread_only=1')->assertJsonPath('meta.total', 1)
        ->assertJsonPath('data.0.event', 'mentioned');

    $this->artisan('app:send-notification-mails', ['--now' => true])->assertSuccessful();
    Mail::assertSent(NotificationDigest::class, 1);
    Mail::assertSent(NotificationDigest::class, fn (NotificationDigest $mail) => $mail->hasTo($w['mara']->email)
        && $mail->envelope()->subject === "[{$key}] Kontaktformular");

    $this->getJson('/api/v1/notifications?unread_only=1')->assertJsonPath('data.0.mailed_at', fn (?string $at) => $at !== null);
    // the sent collection is not sent again
    $this->artisan('app:send-notification-mails', ['--now' => true])->assertSuccessful();
    Mail::assertSent(NotificationDigest::class, 1);
});
