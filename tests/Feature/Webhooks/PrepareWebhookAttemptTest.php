<?php

use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Actions\Webhooks\PrepareWebhookAttempt;
use App\Actions\WorkItems\CreateWorkItem;
use App\Events\EventType;
use App\Models\Project;
use App\Models\User;
use App\Models\Webhook;
use App\Models\WebhookAttempt;
use App\Models\WebhookDelivery;
use App\Support\Actor;
use App\Webhooks\Target;
use App\Webhooks\UnsafeTarget;

/*
 * What an attempt may do before it sends (task 7, K6): per kind of attempt, whether the delivery and the webhook still
 * take it, and what it sends to. Scheduled tries stop for a webhook that went off or a bot that lost the project;
 * "send again" goes to a webhook that is off but never past a bot without access; a ping always goes.
 */

beforeEach(fn () => resolver(['receiver.example.com' => ['93.184.216.34']]));

$prepare = fn (WebhookDelivery $delivery, string $kind = WebhookAttempt::SCHEDULED) => PrepareWebhookAttempt::run(Actor::system(User::defaultBot(), 'webhooks'), $delivery->id, $kind);

/** A pending delivery of an event of the private project WEB to a webhook of the bot Kira, who is a member of WEB. */
$botDelivery = function (): array {
    $mara = User::factory()->admin()->create();
    $web = Project::factory()->private()->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $kira = User::factory()->bot($mara)->create();
    app(RoleAssignments::class)->setProjectRole($kira, $web, ProjectRole::Member);
    $item = CreateWorkItem::run(actor($mara), ['project_id' => $web->id, 'title' => 'Formular prüfen']);
    $webhook = Webhook::factory()->forBot($kira)->create(['url' => 'https://receiver.example.com/hook']);
    $delivery = WebhookDelivery::factory()->for($webhook)->create(['event_id' => eventsOf(EventType::WorkItemCreated, $item)->sole()->id]);

    return ['kira' => $kira, 'web' => $web, 'delivery' => $delivery];
};

it('hands over the checked target, the secret, the URL, the body and the event read afresh', function () use ($prepare) {
    $webhook = Webhook::factory()->create(['url' => 'https://receiver.example.com/hook?token=t0k3n']);
    $delivery = WebhookDelivery::factory()->for($webhook)->create(['body' => '{"id":"x"}', 'event' => 'work_item.updated']);

    $prepared = $prepare($delivery);

    expect($prepared['target'])->toBeInstanceOf(Target::class)
        ->and($prepared['target']->addresses)->toBe(['93.184.216.34'])
        ->and($prepared['secret'])->toBe($webhook->secret)
        ->and($prepared['url'])->toBe('https://receiver.example.com/hook?token=t0k3n')
        ->and($prepared['body'])->toBe('{"id":"x"}')
        ->and($prepared['event'])->toBe('work_item.updated');
});

it('hands over a refused target to be logged as a failure', function () use ($prepare) {
    resolver(['receiver.example.com' => ['10.0.0.1']]);
    $delivery = WebhookDelivery::factory()->for(Webhook::factory()->create(['url' => 'https://receiver.example.com/hook']))->create();

    $target = $prepare($delivery)['target'];

    expect($target)->toBeInstanceOf(UnsafeTarget::class)
        ->and($target->reason)->toBe(UnsafeTarget::PRIVATE_ADDRESS)
        ->and($delivery->fresh()->status)->toBe(WebhookDelivery::PENDING);
});

it('has nothing for a delivery that is gone, whatever the kind', function () use ($prepare) {
    $delivery = WebhookDelivery::factory()->create();
    $delivery->delete();

    foreach (WebhookAttempt::KINDS as $kind) {
        expect($prepare($delivery, $kind))->toBeNull();
    }
});

it('tries a scheduled delivery only while it is pending, again and a ping whatever it is', function () use ($prepare) {
    foreach ([WebhookDelivery::SUCCEEDED, WebhookDelivery::FAILED, WebhookDelivery::CANCELLED] as $status) {
        $delivery = WebhookDelivery::factory()->for(Webhook::factory()->create(['url' => 'https://receiver.example.com/hook']))->create(['status' => $status]);

        expect($prepare($delivery))->toBeNull()
            ->and($prepare($delivery, WebhookAttempt::MANUAL)['target'])->toBeInstanceOf(Target::class)
            ->and($prepare($delivery, WebhookAttempt::PING)['target'])->toBeInstanceOf(Target::class)
            ->and($delivery->fresh()->status)->toBe($status);
    }
});

it('cancels a scheduled try of a webhook that is off, and sends again or pings it all the same', function () use ($prepare) {
    $off = WebhookDelivery::factory()->for(Webhook::factory()->create(['active' => false, 'url' => 'https://receiver.example.com/hook']))->create();
    $disabled = WebhookDelivery::factory()->for(Webhook::factory()->disabled()->create(['url' => 'https://receiver.example.com/hook']))->create();

    foreach ([$off, $disabled] as $delivery) {
        expect($prepare($delivery, WebhookAttempt::MANUAL)['target'])->toBeInstanceOf(Target::class)
            ->and($prepare($delivery, WebhookAttempt::PING)['target'])->toBeInstanceOf(Target::class)
            ->and($delivery->fresh()->status)->toBe(WebhookDelivery::PENDING)
            ->and($prepare($delivery))->toBeNull()
            ->and($delivery->fresh()->status)->toBe(WebhookDelivery::CANCELLED);
    }
});

it('goes on for a bot that still sees the project', function () use ($prepare, $botDelivery) {
    $w = $botDelivery();

    expect($prepare($w['delivery'])['target'])->toBeInstanceOf(Target::class)
        ->and($prepare($w['delivery'], WebhookAttempt::MANUAL)['target'])->toBeInstanceOf(Target::class);
});

it('stops a bot that lost the project: cancelled when scheduled, refused when sent again, a ping goes', function () use ($prepare, $botDelivery) {
    $w = $botDelivery();
    app(RoleAssignments::class)->removeFromProject($w['kira'], $w['web']);

    $again = $prepare($w['delivery'], WebhookAttempt::MANUAL)['target'];
    expect($again)->toBeInstanceOf(UnsafeTarget::class)
        ->and($again->reason)->toBe(UnsafeTarget::BOT_ACCESS)
        ->and($prepare($w['delivery'], WebhookAttempt::PING)['target'])->toBeInstanceOf(Target::class)
        ->and($w['delivery']->fresh()->status)->toBe(WebhookDelivery::PENDING)
        ->and($prepare($w['delivery']))->toBeNull()
        ->and($w['delivery']->fresh()->status)->toBe(WebhookDelivery::CANCELLED);
});

it('stops a deactivated bot', function () use ($prepare, $botDelivery) {
    $w = $botDelivery();
    $w['kira']->update(['disabled_at' => now()]);

    expect($prepare($w['delivery']))->toBeNull()
        ->and($w['delivery']->fresh()->status)->toBe(WebhookDelivery::CANCELLED);
});

it('stops a bot once the project is being deleted', function () use ($prepare, $botDelivery) {
    $w = $botDelivery();
    $w['web']->update(['deleting_at' => now()]);

    expect($prepare($w['delivery']))->toBeNull()
        ->and($w['delivery']->fresh()->status)->toBe(WebhookDelivery::CANCELLED);
});

it('stops a bot whose delivery names no event it can see', function () use ($prepare) {
    $kira = User::factory()->bot(User::factory()->admin()->create())->create();
    $delivery = WebhookDelivery::factory()->for(Webhook::factory()->forBot($kira)->create(['url' => 'https://receiver.example.com/hook']))->create();

    expect($prepare($delivery))->toBeNull()
        ->and($delivery->fresh()->status)->toBe(WebhookDelivery::CANCELLED);
});
