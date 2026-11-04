<?php

use App\Live\Broadcasts;
use App\Live\LiveMessage;
use App\Models\Notification;
use App\Models\User;
use Illuminate\Broadcasting\BroadcastException;
use Illuminate\Support\Facades\Exceptions;

/*
 * The one way to Reverb (A284, A297): after a failure the app sends nothing for DOWN_SECONDS (`live-down` in the
 * cache): a Reverb that is down costs one timeout, not one per message. Disconnecting tries all the same (M7: losing
 * access is rare and matters), and a failure there sets the mark too. Reports stay at one in REPORT_PAUSE.
 */

beforeEach(function () {
    $this->live = broadcasts();
    Exceptions::fake();
});

$message = fn (string $user = 'u_mara') => LiveMessage::notificationsChanged($user, null);

it('sends nothing for 30 seconds after a failure, then tries again', function () use ($message) {
    $this->freezeTime();
    $this->live->failWith(new BroadcastException('Pusher error: cURL error 7: Failed to connect.'));

    Broadcasts::send($message());
    expect($this->live->attempts())->toBe(1);

    // Reverb answers again, but the app does not ask within the pause
    $this->live->failWith(null);
    $this->travel(Broadcasts::DOWN_SECONDS - 1)->seconds();
    Broadcasts::send($message());
    expect($this->live->attempts())->toBe(1)
        ->and($this->live->sent())->toBe([]);

    $this->travel(2)->seconds();
    Broadcasts::send($message());
    expect($this->live->attempts())->toBe(2)
        ->and($this->live->sent())->toHaveCount(1);
    Exceptions::assertReportedCount(1);
});

it('disconnects in spite of the mark, and a failure there sets it', function () {
    $this->freezeTime();
    $this->live->failWith(new BroadcastException('down'));
    Broadcasts::send(LiveMessage::notificationsChanged('u_mara', null));
    $this->live->failWith(null);

    Broadcasts::terminate(['u_ida']);
    expect($this->live->terminated())->toBe(['u_ida']);

    $this->travel(Broadcasts::DOWN_SECONDS + 1)->seconds();
    $this->live->failWith(new BroadcastException('down'));
    Broadcasts::terminate(['u_ida']);
    $this->live->failWith(null);
    $attempts = $this->live->attempts();

    Broadcasts::send(LiveMessage::notificationsChanged('u_mara', null));
    expect($this->live->attempts())->toBe($attempts)
        ->and($this->live->sent())->toBe([]);
});

it('answers an inbox call while Reverb is marked down without trying it', function () {
    $mara = User::factory()->create();
    $one = Notification::factory()->create(['user_id' => $mara->id]);
    $this->live->failWith(new BroadcastException('down'));
    Broadcasts::send(LiveMessage::notificationsChanged($mara->id, null));
    $this->live->failWith(null);

    $this->actingAs($mara)->postJson('/api/v1/notifications/read', ['ids' => [$one->id]])->assertOk()->assertJson(['updated' => 1]);

    expect($this->live->attempts())->toBe(1)
        ->and($one->fresh()?->read_at)->not->toBeNull();
});
