<?php

use App\Access\ProjectRole;
use App\Actions\Notifications\SendNotificationMail;
use App\Domain\Notifications\NotificationKind;
use App\Models\Comment;
use App\Models\Notification;
use App\Models\NotificationMail;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use App\Support\Actor;
use Tests\Support\Mailpit;
use Tests\Support\RichTextFixtures as F;

/*
 * The digest over real SMTP (Task 7): Mailpit receives it with subject, HTML with the link to the item and a text part,
 * and without attachments. The test writes to an address of its own and forgets only its own message (K17).
 */

it('delivers the digest over SMTP', function () {
    Mailpit::use();
    config(['app.url' => 'https://werkbuch.example.com']);
    $mara = User::factory()->create(['name' => 'Mara', 'email' => Mailpit::address()]);
    $ida = User::factory()->create(['name' => 'Ida']);
    $web = Project::factory()->identifier('WEB')->public()->member($mara, ProjectRole::Member)->create();
    $item = WorkItem::factory()->for($web)->create(['title' => 'Kontaktformular']);
    $comment = Comment::factory()->for($item, 'workItem')->create(['author_id' => $ida->id, 'body' => F::doc(F::p('Das Formular ist ', F::text('live', 'bold'), '.'))]);
    $mail = NotificationMail::factory()->create(['user_id' => $mara->id, 'scope' => "item:{$item->id}"]);
    Notification::factory()->forItem($item)->kind(NotificationKind::Comment, ['comment_id' => $comment->id])
        ->create(['user_id' => $mara->id, 'mail_id' => $mail->id, 'actor_id' => $ida->id]);

    expect(SendNotificationMail::run(Actor::system(User::defaultBot(), 'notification_mail'), $mail->id))->toBe(NotificationMail::SENT);

    $messages = Mailpit::messagesTo($mara->email);
    try {
        expect($messages)->toHaveCount(1);
        $id = (string) $messages[0]['ID'];
        $message = Mailpit::message($id);
        expect($message['Subject'])->toBe('[WEB-1] Kontaktformular')
            ->and($message['Attachments'])->toBe([])
            ->and($message['Inline'])->toBe([])
            ->and(Mailpit::html($id))->toContain('href="https://werkbuch.example.com/items/WEB-1"')
            ->toContain('Ida commented')->toContain('<strong>live</strong>')
            ->and(Mailpit::text($id))->toContain('Ida commented')->toContain('Das Formular ist live.')
            ->toContain('https://werkbuch.example.com/me/notifications')->not->toContain('<');
    } finally {
        Mailpit::forget(array_map(fn (array $message) => (string) $message['ID'], $messages));
    }
});
