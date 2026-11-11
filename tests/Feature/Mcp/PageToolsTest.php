<?php

use App\Access\ProjectRole;
use App\Events\EventType;
use App\Models\Page;
use App\Models\PageVersion;
use App\Models\Project;
use App\Models\User;
use Tests\Support\Mcp\McpClient;
use Tests\Support\RichTextFixtures as F;

/*
 * The pair `pages` / `manage-pages` (phase 13, task 9; K6, K8, K17): the wikis over MCP. That every action answers what
 * its REST twin answers, McpParityTest says (tools.php); this file pins what only MCP meets: the tree as REST sends it,
 * the conflict of a stale save with the current page in Markdown, "keep my version", and a member who is refused.
 */

/** WEB with Mara and Theo as members and a page of Mara. */
$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara']);
    $theo = User::factory()->create(['name' => 'Theo']);
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Member)->member($theo, ProjectRole::Member)->create(['lead_id' => $mara->id]);
    $page = Page::factory()->for($web)->withText('Erste Fassung')->create(['title' => 'Ablauf', 'created_by' => $mara->id, 'updated_by' => $mara->id]);

    return [$web, $page, $mara, $theo];
};

it('answers the tree like REST: a list of nodes with the total and no path', function () use ($world) {
    [$web, $page, , $theo] = $world();
    $child = Page::factory()->for($web)->childOf($page)->create(['title' => 'Unterseite']);

    $tree = McpClient::for($this, apiToken($theo, ['read', 'mcp']))->call('pages', ['action' => 'tree', 'project' => 'web']);
    $body = $tree['structuredContent'];

    expect($tree['isError'])->toBeFalse((string) json_encode($tree))
        ->and($body['meta'])->toBe(['total' => 2])
        ->and(array_column($body['data'], 'id'))->toBe([$page->id])
        ->and(array_column($body['data'][0]['children'], 'id'))->toBe([$child->id])
        ->and(array_key_exists('content', $body['data'][0]))->toBeFalse((string) json_encode($body['data'][0]));
});

it('answers a stale save with page_conflict and the current page in markdown', function () use ($world) {
    [, $page, $mara, $theo] = $world();
    $mcp = McpClient::for($this, apiToken($theo, ['read', 'write', 'mcp']));
    $page->forceFill(['version' => 3, 'updated_by' => $mara->id])->save();

    $conflict = $mcp->call('manage-pages', ['action' => 'update', 'page' => $page->id, 'input' => ['content' => 'Meine Fassung', 'base_version' => 2]]);
    $current = $conflict['structuredContent']['current'];

    expect($conflict['isError'])->toBeTrue()
        ->and($conflict['structuredContent']['status'])->toBe(409)
        ->and($conflict['structuredContent']['reason'])->toBe('page_conflict')
        ->and($current['version'])->toBe(3)
        ->and($current['content'])->toBe('Erste Fassung')
        ->and(array_key_exists('content_json', $current))->toBeFalse((string) json_encode($current))
        ->and($page->fresh()?->version)->toBe(3)
        ->and(eventsOf(EventType::PageUpdated, $page))->toHaveCount(0);
});

it('keeps the stored state as a version only when asked to keep the current one', function () use ($world) {
    [, $page, , $theo] = $world();
    $mcp = McpClient::for($this, apiToken($theo, ['read', 'write', 'mcp']));
    // the stored state is the writer's own and fresh (within the pause), so only `keep_current` can make a version
    $page->forceFill(['updated_by' => $theo->id, 'updated_at' => now()])->save();

    $plain = $mcp->call('manage-pages', ['action' => 'update', 'page' => $page->id, 'input' => ['content' => 'Zweite Fassung', 'base_version' => 1]]);
    expect($plain['isError'])->toBeFalse((string) json_encode($plain))
        ->and($plain['structuredContent']['data']['version'])->toBe(2)
        ->and(PageVersion::query()->count())->toBe(0);

    $saved = $mcp->call('manage-pages', ['action' => 'update', 'page' => $page->id, 'input' => ['content' => 'Fassung von Theo', 'base_version' => 2, 'keep_current' => true]]);
    $version = PageVersion::query()->sole();

    expect($saved['isError'])->toBeFalse((string) json_encode($saved))
        ->and($saved['structuredContent']['data']['content'])->toBe('Fassung von Theo')
        ->and($saved['structuredContent']['data']['version'])->toBe(3)
        ->and([$version->page_id, $version->version])->toBe([$page->id, 2]);

    $versions = $mcp->call('pages', ['action' => 'versions', 'page' => $page->id]);
    $read = $mcp->call('pages', ['action' => 'version', 'page' => $page->id, 'page_version' => $version->id]);
    expect(array_column($versions['structuredContent']['data'], 'id'))->toBe([$version->id])
        ->and($versions['structuredContent']['meta']['per_page'])->toBe(25)
        ->and($read['structuredContent']['data']['content'])->toBe('Zweite Fassung');
});

it('keeps a table without a header row when an agent writes back the markdown it read (A455)', function () use ($world) {
    [, $page, , $theo] = $world();
    $table = fn (string $chrome) => F::doc(F::table(
        [F::cell('tableCell', 'Safari'), F::cell('tableCell', '2')],
        [F::cell('tableCell', 'Chrome'), F::cell('tableCell', $chrome)],
    ));
    $page->forceFill(['content' => $table('1')])->save();
    $mcp = McpClient::for($this, apiToken($theo, ['read', 'write', 'mcp']));

    $markdown = $mcp->call('pages', ['action' => 'get', 'page' => $page->id])['structuredContent']['data']['content'];
    $saved = $mcp->call('manage-pages', ['action' => 'update', 'page' => $page->id, 'input' => ['content' => str_replace('| Chrome | 1 |', '| Chrome | 0 |', $markdown)]]);

    expect($markdown)->toBe("| Safari | 2 |\n| --- | --- |\n| Chrome | 1 |")
        ->and($saved['isError'])->toBeFalse((string) json_encode($saved))
        ->and($page->fresh()?->content)->toBe($table('0'));
});

it('refuses to move a page into its own subtree', function () use ($world) {
    [$web, $page, , $theo] = $world();
    $child = Page::factory()->for($web)->childOf($page)->create(['title' => 'Unterseite']);
    $mcp = McpClient::for($this, apiToken($theo, ['read', 'write', 'mcp']));

    $moved = $mcp->call('manage-pages', ['action' => 'move', 'page' => $page->id, 'input' => ['parent_id' => $child->id, 'before_id' => null]]);

    expect($moved['isError'])->toBeTrue()
        ->and($moved['structuredContent']['status'])->toBe(422)
        ->and($moved['structuredContent']['errors']['parent_id'])->toBe([__('field.parent_page.cycle')])
        ->and($page->fresh()?->parent_id)->toBeNull();
});

it('moves, restores and deletes a subtree', function () use ($world) {
    [$web, $page, , $theo] = $world();
    $child = Page::factory()->for($web)->childOf($page)->create(['title' => 'Unterseite']);
    $other = Page::factory()->for($web)->create(['title' => 'Anderes']);
    $mcp = McpClient::for($this, apiToken($theo, ['read', 'write', 'mcp']));

    $moved = $mcp->call('manage-pages', ['action' => 'move', 'page' => $other->id, 'input' => ['parent_id' => $child->id, 'before_id' => null]]);
    expect($moved['isError'])->toBeFalse((string) json_encode($moved))
        ->and($moved['structuredContent']['data']['parent_id'])->toBe($child->id);

    $version = PageVersion::factory()->create(['page_id' => $page->id, 'version' => 1, 'title' => 'Alter Titel']);
    $restored = $mcp->call('manage-pages', ['action' => 'restore-version', 'page' => $page->id, 'page_version' => $version->id]);
    expect($restored['structuredContent']['data']['title'])->toBe('Alter Titel');

    $deleted = $mcp->call('manage-pages', ['action' => 'delete', 'page' => $page->id]);
    expect($deleted['structuredContent'])->toBe(['deleted' => 3])
        ->and(Page::query()->count())->toBe(0);
});

it('refuses a viewer to write and an unknown page with 404', function () use ($world) {
    [$web, $page] = $world();
    $viewer = memberOf($web, ProjectRole::Viewer);
    $mcp = McpClient::for($this, apiToken($viewer, ['read', 'write', 'mcp']));

    $refused = $mcp->call('manage-pages', ['action' => 'update', 'page' => $page->id, 'input' => ['title' => 'Nein']]);
    $unknown = $mcp->call('pages', ['action' => 'get', 'page' => 'not-a-ulid']);

    expect($refused['isError'])->toBeTrue()
        ->and($refused['structuredContent']['status'])->toBe(403)
        ->and($refused['structuredContent']['detail'])->toBe(__('problem.detail.wiki_members_only'))
        ->and($page->fresh()?->title)->toBe('Ablauf')
        ->and([$unknown['structuredContent']['status'], $unknown['structuredContent']['reason']])->toBe([404, 'not_found']);
});
