<?php

use App\Access\ProjectRole;
use App\Domain\Notifications\NotificationKind;
use App\Models\Notification;
use App\Models\NotificationPreference;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use Tests\Support\Mcp\McpClient;

/*
 * The pair `notifications` / `manage-notifications` (phase 13, task 10; K6, K17): the own inbox over MCP. That every
 * action answers what its REST twin answers, McpParityTest says (tools.php); this file pins what only MCP meets: the
 * filters of the list as REST reads them, the other tabs of the person hearing a change (without a socket), the empty
 * inbox of a bot and the default bot who has no settings.
 */

/** WEB with Mara as a member and three notifications of hers: one unread mention, one unread comment, one read. */
$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara']);
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Member)->create(['lead_id' => $mara->id]);
    $item = WorkItem::factory()->for($web)->create(['created_by' => $mara->id]);
    $make = fn (string $kind, bool $read = false): Notification => Notification::factory()->forItem($item)->kind(NotificationKind::from($kind))
        ->state(['user_id' => $mara->id, 'read_at' => $read ? now() : null])->create();

    return [$mara, $item, $make('mentioned'), $make('comment'), $make('assigned', true)];
};

it('lists the inbox with the filters of REST', function () use ($world) {
    [$mara, , $mention, $comment, $read] = $world();
    $mcp = McpClient::for($this, apiToken($mara, ['read', 'mcp']));

    $all = $mcp->call('notifications', ['action' => 'list']);
    $unread = $mcp->call('notifications', ['action' => 'list', 'filter' => ['unread' => 1]]);
    $mentions = $mcp->call('notifications', ['action' => 'list', 'filter' => ['event' => 'mentioned']]);
    $ids = fn (array $result): array => array_column($result['structuredContent']['data'], 'id');

    expect($all['isError'])->toBeFalse((string) json_encode($all))
        ->and($ids($all))->toEqualCanonicalizing([$mention->id, $comment->id, $read->id])
        ->and($all['structuredContent']['meta']['per_page'])->toBe(25)
        ->and($ids($unread))->toEqualCanonicalizing([$mention->id, $comment->id])
        ->and($ids($mentions))->toBe([$mention->id]);
});

it('reads a bot\'s inbox as empty', function () use ($world) {
    $world();
    $bot = User::factory()->bot()->create();
    $mcp = McpClient::for($this, apiToken($bot, ['read', 'mcp']));

    $list = $mcp->call('notifications', ['action' => 'list']);

    expect($list['isError'])->toBeFalse((string) json_encode($list))
        ->and($list['structuredContent']['data'])->toBe([]);
});

it('marks read by ids and by all and tells the other tabs without a socket', function () use ($world) {
    [$mara, , $mention, $comment] = $world();
    $live = broadcasts();
    $mcp = McpClient::for($this, apiToken($mara, ['read', 'write', 'mcp']));

    $byIds = $mcp->call('manage-notifications', ['action' => 'read', 'input' => ['ids' => [$mention->id]]]);
    $byAll = $mcp->call('manage-notifications', ['action' => 'read', 'input' => ['all' => true, 'mentions_only' => true]]);
    $rest = $mcp->call('manage-notifications', ['action' => 'read', 'input' => ['all' => true]]);

    expect($byIds['structuredContent'])->toBe(['updated' => 1])
        // the mention is read already; mentions_only has nothing left to mark
        ->and($byAll['structuredContent'])->toBe(['updated' => 0])
        ->and($rest['structuredContent'])->toBe(['updated' => 1])
        ->and($comment->fresh()?->read_at)->not->toBeNull();

    $sent = array_values(array_filter($live->sent(), fn (array $m) => $m['payload']['type'] === 'notifications.changed'));
    // one tell per change: ids and the rest, none for the call that changed nothing
    expect($sent)->toHaveCount(2)
        ->and($sent[0]['channels'])->toBe(["presence-user.{$mara->id}"])
        ->and($sent[0]['socket'])->toBeNull()
        ->and($sent[1]['socket'])->toBeNull();
});

it('marks unread and deletes one', function () use ($world) {
    [$mara, , , , $read] = $world();
    $live = broadcasts();
    $mcp = McpClient::for($this, apiToken($mara, ['read', 'write', 'mcp']));

    $unread = $mcp->call('manage-notifications', ['action' => 'unread', 'input' => ['ids' => [$read->id]]]);
    $deleted = $mcp->call('manage-notifications', ['action' => 'delete', 'notification' => $read->id]);

    expect($unread['structuredContent'])->toBe(['updated' => 1])
        ->and($deleted['structuredContent'])->toBe(['done' => true])
        ->and(Notification::query()->whereKey($read->id)->exists())->toBeFalse()
        ->and(array_column(array_column($live->sent(), 'payload'), 'type'))->toBe(['notifications.changed', 'notifications.changed']);
});

it('saves the settings of a person and refuses the default bot', function () use ($world) {
    [$mara] = $world();
    $mcp = McpClient::for($this, apiToken($mara, ['read', 'write', 'mcp']));

    $saved = $mcp->call('manage-notifications', ['action' => 'save-preferences', 'input' => ['preferences' => [['event' => 'comment', 'channel' => 'mail', 'enabled' => true]]]]);
    $read = $mcp->call('notifications', ['action' => 'preferences']);
    $cell = fn (array $result) => collect($result['structuredContent']['data'])->first(fn (array $row) => $row['event'] === 'comment' && $row['channel'] === 'mail');

    expect($saved['isError'])->toBeFalse((string) json_encode($saved))
        ->and($cell($saved)['enabled'])->toBeTrue()
        ->and($cell($read)['enabled'])->toBeTrue()
        ->and(NotificationPreference::query()->where('user_id', $mara->id)->count())->toBe(1);

    $bot = McpClient::for($this, apiToken(User::defaultBot(), ['read', 'write', 'mcp']));
    $refused = $bot->call('manage-notifications', ['action' => 'save-preferences', 'input' => ['preferences' => [['event' => 'comment', 'channel' => 'mail', 'enabled' => true]]]]);

    expect($refused['isError'])->toBeTrue()
        ->and($refused['structuredContent']['status'])->toBe(403)
        ->and($refused['structuredContent']['detail'])->toBe(__('problem.detail.persons_only_notifications'))
        ->and(NotificationPreference::query()->where('user_id', User::defaultBot()->id)->count())->toBe(0);
});

it('answers a foreign notification with 404', function () use ($world) {
    [$mara] = $world();
    $other = Notification::factory()->create(['user_id' => User::factory()->create()->id]);
    $mcp = McpClient::for($this, apiToken($mara, ['read', 'write', 'mcp']));

    $deleted = $mcp->call('manage-notifications', ['action' => 'delete', 'notification' => $other->id]);

    expect([$deleted['structuredContent']['status'], $deleted['structuredContent']['reason']])->toBe([404, 'not_found'])
        ->and(Notification::query()->whereKey($other->id)->exists())->toBeTrue();
});
