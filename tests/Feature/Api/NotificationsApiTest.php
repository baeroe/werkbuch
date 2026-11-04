<?php

use App\Access\ProjectRole;
use App\Domain\Notifications\NotificationKind;
use App\Models\Comment;
use App\Models\Event;
use App\Models\Notification;
use App\Models\NotificationMail;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use Tests\Support\RichTextFixtures as F;

/** The shape of `Notification` in prototypes/clickdummy/src/types.ts, plus `excerpt` and the lean `item` (A272). */
const NOTIFICATION_SHAPE = ['id', 'user_id', 'event', 'event_id', 'project_id', 'work_item_id', 'actor_id', 'data', 'excerpt', 'read_at', 'mailed_at', 'created_at', 'item'];

$world = function (): array {
    $tom = User::factory()->create(['name' => 'Tom', 'handle' => 'tom']);
    $web = Project::factory()->identifier('WEB')->public()->member($tom, ProjectRole::Admin)->create();
    $mara = memberOf($web, ProjectRole::Member, ['name' => 'Mara', 'handle' => 'mara']);

    return ['tom' => $tom, 'mara' => $mara, 'item' => WorkItem::factory()->for($web)->create(['title' => 'Kontaktformular'])];
};

it('lists the inbox in the shape of the clickdummy, with a lean item', function () use ($world) {
    $w = $world();
    $comment = Comment::factory()->for($w['item'], 'workItem')->create(['author_id' => $w['tom']->id, 'body' => F::doc(F::p('Siehe ', F::mention($w['mara']->id, 'mara')))]);
    $event = Event::query()->firstOrFail();
    $mail = NotificationMail::factory()->sent(Carbon::parse('2026-11-03 10:05:00', 'UTC'))->create(['user_id' => $w['mara']->id]);
    // a skipped collection has a `sent_at` as well, but no mail went out (K8)
    $skipped = NotificationMail::factory()->skipped()->create(['user_id' => $w['mara']->id]);
    $notification = Notification::factory()->forItem($w['item'])->kind(NotificationKind::Comment, ['comment_id' => $comment->id])->create([
        'user_id' => $w['mara']->id, 'event_id' => $event->id, 'actor_id' => $w['tom']->id, 'mail_id' => $mail->id,
        'created_at' => Carbon::parse('2026-11-03 10:00:00.123456', 'UTC'),
    ]);
    $empty = Notification::factory()->forItem($w['item'])->kind(NotificationKind::ItemCreated)->read()
        ->create(['user_id' => $w['mara']->id, 'mail_id' => $skipped->id, 'created_at' => Carbon::parse('2026-11-03 09:00:00', 'UTC')]);

    $response = $this->actingAs($w['mara'])->getJson('/api/v1/notifications?per_page=1');
    $response->assertOk()
        ->assertJsonStructure(['data' => [NOTIFICATION_SHAPE], 'links', 'meta' => ['next_cursor', 'total']])
        ->assertJsonPath('meta.total', 2)
        ->assertJsonPath('data.0', [
            'id' => $notification->id,
            'user_id' => $w['mara']->id,
            'event' => 'comment',
            'event_id' => $event->id,
            'project_id' => $w['item']->project_id,
            'work_item_id' => $w['item']->id,
            'actor_id' => $w['tom']->id,
            'data' => ['comment_id' => $comment->id],
            'excerpt' => 'Siehe @Mara',
            'read_at' => null,
            'mailed_at' => '2026-11-03T10:05:00.000000Z',
            'created_at' => '2026-11-03T10:00:00.123456Z',
            'item' => $response->json('data.0.item'),
        ])
        ->assertJsonPath('data.0.item.key', $w['item']->key)
        ->assertJsonPath('data.0.item.title', 'Kontaktformular');
    expect($response->json('data.0.item'))->not->toHaveKey('description')->not->toHaveKey('description_json');

    // the next page by the link, which keeps the query; `data` an object even when empty
    $this->getJson($response->json('links.next'))->assertOk()
        ->assertJsonPath('data.0.id', $empty->id)->assertJsonPath('data.0.read_at', $empty->fresh()->read_at->toJSON())
        ->assertJsonPath('data.0.mailed_at', null)->assertJsonPath('data.0.excerpt', null);
    expect($this->getJson($response->json('links.next'))->getContent())->toContain('"data":{}');

    $this->getJson('/api/v1/notifications?unread_only=1')->assertJsonPath('meta.total', 1);
    $this->getJson('/api/v1/notifications?mentions_only=yes')->assertUnprocessable()
        ->assertJsonPath('errors', ['mentions_only' => [__('field.boolean')]]);
});

it('gives a notification without item no item', function () {
    $admin = User::factory()->admin()->create();
    Notification::factory()->kind(NotificationKind::WebhookDisabled, ['webhook_id' => '01jcwebh00k000000000000000'])
        ->create(['user_id' => $admin->id, 'work_item_id' => null, 'project_id' => null]);

    $this->actingAs($admin)->getJson('/api/v1/notifications')->assertOk()
        ->assertJsonPath('data.0.item', null)->assertJsonPath('data.0.project_id', null)
        ->assertJsonPath('data.0.event', 'webhook_disabled');
});

it('marks read and unread and deletes, answering without data', function () use ($world) {
    $w = $world();
    $one = Notification::factory()->forItem($w['item'])->create(['user_id' => $w['mara']->id]);
    $two = Notification::factory()->forItem($w['item'])->kind(NotificationKind::Mentioned, ['source' => 'values'])->create(['user_id' => $w['mara']->id]);

    $this->actingAs($w['mara'])->postJson('/api/v1/notifications/read', ['ids' => [$one->id]])->assertOk()->assertExactJson(['updated' => 1]);
    $this->postJson('/api/v1/notifications/read', ['all' => true, 'mentions_only' => true])->assertExactJson(['updated' => 1]);
    $this->postJson('/api/v1/notifications/unread', ['ids' => [$one->id, $two->id]])->assertExactJson(['updated' => 2]);
    $this->postJson('/api/v1/notifications/read', ['ids' => []])->assertUnprocessable()
        ->assertJsonPath('errors', ['ids' => [__('field.ids.notifications', ['max' => 100])]]);

    // by its ULID in any case
    $this->deleteJson('/api/v1/notifications/'.strtoupper($one->id))->assertNoContent();
    expect(Notification::query()->find($one->id))->toBeNull();
});

it('answers 404 for a notification that is not one, or not mine', function () use ($world) {
    $w = $world();
    $foreign = Notification::factory()->forItem($w['item'])->create(['user_id' => $w['tom']->id]);

    $this->actingAs($w['mara']);
    foreach (['not-a-ulid', Str::lower((string) Str::ulid()), $foreign->id] as $ref) {
        $this->deleteJson("/api/v1/notifications/{$ref}")->assertNotFound()->assertJsonMissingPath('detail');
    }
    expect($foreign->fresh())->not->toBeNull();
});

it('lets a read token read the inbox and wants write to change it', function () use ($world) {
    $w = $world();
    $one = Notification::factory()->forItem($w['item'])->create(['user_id' => $w['mara']->id]);

    $this->withToken(apiToken($w['mara'], ['read']))->getJson('/api/v1/notifications')->assertOk()->assertJsonPath('meta.total', 1);
    $this->postJson('/api/v1/notifications/read', ['ids' => [$one->id]])->assertForbidden();
    $this->deleteJson("/api/v1/notifications/{$one->id}")->assertForbidden();
    expect($one->fresh()->read_at)->toBeNull();

    forgetApiAuth();
    $this->withToken(apiToken($w['mara'], ['write']))->postJson('/api/v1/notifications/read', ['ids' => [$one->id]])->assertExactJson(['updated' => 1]);
});
