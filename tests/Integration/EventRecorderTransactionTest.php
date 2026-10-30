<?php

use App\Events\EventRecorder;
use App\Events\EventType;
use App\Models\Event;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Tests\Support\RecordingConsumer;

// without the test transaction of RefreshDatabase: here the transaction level really is 0 outside of an action

beforeEach(function () {
    consumers(RecordingConsumer::class);
    RecordingConsumer::$seen = [];
});

it('records events only inside a transaction', function () {
    $user = User::factory()->create();

    expect(fn () => EventRecorder::record(EventType::UserUpdated, actor($user), $user, null))
        ->toThrow(LogicException::class, 'Events are recorded inside the transaction of an action.')
        ->and(Event::query()->count())->toBe(0);
});

it('hands the event to the consumers only after the commit', function () {
    $user = User::factory()->create();

    $event = DB::transaction(function () use ($user) {
        $event = EventRecorder::record(EventType::UserUpdated, actor($user), $user, null);

        expect(RecordingConsumer::$seen)->toBe([]);

        return $event;
    });

    expect(RecordingConsumer::$seen)->toBe([$event->id])
        ->and($event->fresh()?->dispatched_at)->not->toBeNull();
});
