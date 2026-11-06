<?php

use App\Actions\Webhooks\DeleteWebhook;
use App\Events\EventType;
use App\Models\Event;
use App\Models\Project;
use App\Models\User;
use App\Models\Webhook;
use App\Models\WebhookAttempt;
use App\Models\WebhookDelivery;

// Deleting a webhook (plan "REST"): its deliveries and attempts go by cascade, the event keeps its name in `meta`.

it('deletes a webhook with its deliveries and attempts and names it in the event', function () {
    $admin = User::factory()->admin()->create();
    $project = Project::factory()->create();
    $webhook = Webhook::factory()->forProject($project)->create(['name' => 'Agent']);
    $delivery = WebhookDelivery::factory()->for($webhook)->create();
    WebhookAttempt::factory()->for($delivery, 'delivery')->create();

    DeleteWebhook::run(actor($admin), $webhook);

    expect(Webhook::query()->count())->toBe(0)
        ->and(WebhookDelivery::query()->count())->toBe(0)
        ->and(WebhookAttempt::query()->count())->toBe(0);

    $event = Event::query()->where('type', EventType::WebhookDeleted)->sole();
    expect($event->subject_id)->toBe($webhook->id)
        ->and($event->actor_id)->toBe($admin->id)
        ->and($event->project_id)->toBe($project->id)
        ->and($event->changes)->toBeNull()
        ->and($event->meta)->toMatchArray(['name' => 'Agent']);
});

it('lets only accounts with org.manage delete webhooks', function () {
    $webhook = Webhook::factory()->create();

    expect(problemOf(fn () => DeleteWebhook::run(actor(User::factory()->create()), $webhook)))
        ->status->toBe(403)
        ->detail->toBe(__('problem.detail.webhooks_admins_only'))
        ->and(Webhook::query()->count())->toBe(1);
});

it('answers 404 for a webhook deleted meanwhile and records nothing twice', function () {
    $admin = User::factory()->admin()->create();
    $webhook = Webhook::factory()->create();
    DeleteWebhook::run(actor($admin), $webhook);

    expect(problemOf(fn () => DeleteWebhook::run(actor($admin), $webhook))->status)->toBe(404)
        ->and(Event::query()->where('type', EventType::WebhookDeleted)->count())->toBe(1);
});
