<?php

use App\Actions\Webhooks\RotateWebhookSecret;
use App\Events\EventType;
use App\Models\User;
use App\Models\Webhook;
use Illuminate\Support\Facades\DB;

// A new secret (A369): made by the server, shown in the answer once, valid at once; the event names no secret.

it('makes a new secret, stores it and records it without changes', function () {
    $admin = User::factory()->admin()->create();
    $webhook = Webhook::factory()->create();
    $old = $webhook->secret;

    $rotated = RotateWebhookSecret::run(actor($admin), $webhook);

    expect($rotated['secret'])->toMatch('/^whsec_[A-Za-z0-9_-]{43}\z/')
        ->and($rotated['secret'])->not->toBe($old)
        ->and($rotated['webhook']->id)->toBe($webhook->id)
        ->and($webhook->fresh()?->secret)->toBe($rotated['secret']);

    $event = eventsOf(EventType::WebhookSecretRotated, $webhook)->sole();
    expect($event->actor_id)->toBe($admin->id)
        ->and($event->changes)->toBeNull()
        ->and(DB::table('events')->where('changes', 'like', '%whsec_%')->orWhere('meta', 'like', '%whsec_%')->count())->toBe(0);
});

it('lets only accounts with org.manage make a new secret', function () {
    $webhook = Webhook::factory()->create();
    $old = $webhook->secret;

    expect(problemOf(fn () => RotateWebhookSecret::run(actor(User::factory()->create()), $webhook)))
        ->status->toBe(403)
        ->detail->toBe(__('problem.detail.webhooks_admins_only'))
        ->and($webhook->fresh()?->secret)->toBe($old);
});

it('answers 404 for a webhook deleted meanwhile', function () {
    $webhook = Webhook::factory()->create();
    Webhook::query()->whereKey($webhook->id)->delete();

    expect(problemOf(fn () => RotateWebhookSecret::run(actor(User::factory()->admin()->create()), $webhook))->status)->toBe(404);
});
