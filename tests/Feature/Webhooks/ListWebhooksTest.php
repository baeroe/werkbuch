<?php

use App\Actions\Webhooks\GetWebhook;
use App\Actions\Webhooks\ListWebhooks;
use App\Models\User;
use App\Models\Webhook;
use Illuminate\Validation\ValidationException;

// Reading webhooks (plan "REST"): only accounts with org.manage, by name and then ULID.

it('lists every webhook by name and then ULID', function () {
    $b = Webhook::factory()->create(['name' => 'Bravo']);
    $a2 = Webhook::factory()->create(['name' => 'Alpha']);
    $a1 = Webhook::factory()->create(['name' => 'alpha']);
    $ids = collect([$a1, $a2])->sortBy('id')->pluck('id')->all();

    $result = ListWebhooks::run(actor(User::factory()->admin()->create()), []);

    expect($result->total)->toBe(3)
        ->and(collect($result->page->items())->pluck('id')->all())->toBe([...$ids, $b->id]);
});

it('pages the list', function () {
    Webhook::factory()->count(3)->sequence(['name' => 'A'], ['name' => 'B'], ['name' => 'C'])->create();
    $admin = User::factory()->admin()->create();

    $first = ListWebhooks::run(actor($admin), ['per_page' => 2]);
    $second = ListWebhooks::run(actor($admin), ['per_page' => 2, 'cursor' => $first->page->nextCursor()?->encode()]);

    expect(collect($first->page->items())->pluck('name')->all())->toBe(['A', 'B'])
        ->and(collect($second->page->items())->pluck('name')->all())->toBe(['C'])
        ->and(fn () => ListWebhooks::run(actor($admin), ['per_page' => 0]))->toThrow(ValidationException::class);
});

it('lets only accounts with org.manage read webhooks', function () {
    $webhook = Webhook::factory()->create();
    $member = User::factory()->create();

    expect(problemOf(fn () => ListWebhooks::run(actor($member), []))->status)->toBe(403)
        ->and(problemOf(fn () => GetWebhook::run(actor($member), $webhook)))
        ->status->toBe(403)
        ->detail->toBe(__('problem.detail.webhooks_admins_only'));
});

it('gives a webhook to the default bot', function () {
    $webhook = Webhook::factory()->create();

    expect(GetWebhook::run(actor(User::defaultBot()), $webhook)->id)->toBe($webhook->id);
});
