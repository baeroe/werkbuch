<?php

use App\Access\ProjectRole;
use App\Events\EventType;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;

/*
 * The tab that made a change does not hear it again (A282): the interface sends the socket of its connection as
 * X-Socket-ID, the actor keeps it and the event notes it in `meta.socket`; nothing that reads events shows it.
 */

/** WEB with Mara as its admin and one item. */
$web = function (): array {
    $mara = User::factory()->create(['name' => 'Mara']);
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);

    return [$mara, WorkItem::factory()->create(['project_id' => $web->id])];
};

it("records the socket of the request in the event's meta", function () use ($web) {
    [$mara, $item] = $web();

    $this->actingAs($mara)->withHeader('X-Socket-ID', '1234.5678')
        ->patchJson("/api/v1/work-items/{$item->id}", ['title' => 'Kontaktformular'])->assertOk();

    expect(eventsOf(EventType::WorkItemUpdated, $item)->sole()->meta)
        ->toBe(['via' => 'ui', 'reason' => null, 'socket' => '1234.5678']);
});

it('keeps the socket on the events a change records with a reason', function () use ($web) {
    [$mara, $item] = $web();
    $parent = WorkItem::factory()->epic()->create(['project_id' => $item->project_id]);
    $child = WorkItem::factory()->childOf($parent)->create();

    $this->actingAs($mara)->withHeader('X-Socket-ID', '1234.5678')->deleteJson("/api/v1/work-items/{$parent->id}")->assertNoContent();

    expect(eventsOf(EventType::WorkItemUpdated, $child)->sole()->meta)
        ->toBe(['via' => 'ui', 'reason' => 'parent_deleted', 'socket' => '1234.5678']);
});

it('ignores a malformed socket id', function (string $socket) use ($web) {
    [$mara, $item] = $web();

    $this->actingAs($mara)->withHeader('X-Socket-ID', $socket)
        ->patchJson("/api/v1/work-items/{$item->id}", ['title' => 'Kontaktformular'])->assertOk();

    expect(eventsOf(EventType::WorkItemUpdated, $item)->sole()->meta)->toBe(['via' => 'ui', 'reason' => null]);
})->with(['', '1234', '1234.', '.5678', '1234.5678.9', '1234.5678 ', 'a1234.5678', '1234,5678', '1234.5678'."\n"]);

it('ignores the socket of a token', function () use ($web) {
    [$mara, $item] = $web();

    $this->withToken(apiToken($mara, ['write']))->withHeader('X-Socket-ID', '1234.5678')
        ->patchJson("/api/v1/work-items/{$item->id}", ['title' => 'Kontaktformular'])->assertOk();

    expect(eventsOf(EventType::WorkItemUpdated, $item)->sole()->meta)->not->toHaveKey('socket');
});

it('leaves the history without the socket', function () use ($web) {
    [$mara, $item] = $web();

    $this->actingAs($mara)->withHeader('X-Socket-ID', '1234.5678')
        ->patchJson("/api/v1/work-items/{$item->id}", ['title' => 'Kontaktformular'])->assertOk();

    $history = $this->actingAs($mara)->getJson("/api/v1/work-items/{$item->id}/history")->assertOk();

    expect($history->json('data'))->toHaveCount(1)
        ->and($history->json('data.0'))->not->toHaveKey('socket')
        ->and($history->getContent())->not->toContain('1234.5678');
});
