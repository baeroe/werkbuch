<?php

use App\Access\ProjectRole;
use App\Models\Page;
use App\Models\Project;
use App\Models\User;

/*
 * The wiki over REST, reading (Task 3): `GET /api/v1/projects/{project}/pages` (the whole tree without text, A315) and
 * `GET /api/v1/pages/{page}` (`{page}` by its ULID only). WEB (public) with Mara as its admin and Lene as a viewer.
 */

$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara', 'handle' => 'mara']);
    $web = Project::factory()->identifier('WEB')->public()->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $lene = memberOf($web, ProjectRole::Viewer, ['name' => 'Lene', 'handle' => 'lene']);
    $root = Page::factory()->withText('Willkommen')->create(['project_id' => $web->id, 'title' => 'Start', 'emoji' => '👋']);
    $child = Page::factory()->childOf($root)->withText('Wie wir arbeiten')->create(['title' => 'Ablauf']);

    return [$web, $mara, $lene, $root, $child];
};

it('answers the tree of a project with its total and without text', function () use ($world) {
    [$web, , $lene, $root, $child] = $world();

    $response = $this->actingAs($lene)->getJson('/api/v1/projects/web/pages')->assertOk()
        ->assertJsonPath('data.0.id', $root->id)
        ->assertJsonPath('data.0.title', 'Start')
        ->assertJsonPath('data.0.emoji', '👋')
        ->assertJsonPath('data.0.project_id', $web->id)
        ->assertJsonPath('data.0.parent_id', null)
        ->assertJsonPath('data.0.children.0.id', $child->id)
        ->assertJsonPath('data.0.children.0.parent_id', $root->id)
        ->assertJsonPath('data.0.children.0.children', []);

    expect($response->json('meta'))->toBe(['total' => 2])
        ->and(array_keys($response->json()))->toBe(['data', 'meta'])
        ->and(array_keys($response->json('data.0')))->not->toContain('content', 'content_json');
});

it('answers a page with Markdown and JSON, by its ULID in either case', function () use ($world) {
    [, , $lene, , $child] = $world();

    $this->actingAs($lene)->getJson("/api/v1/pages/{$child->id}")->assertOk()
        ->assertJsonPath('data.id', $child->id)
        ->assertJsonPath('data.content', 'Wie wir arbeiten')
        ->assertJsonPath('data.content_json', $child->content)
        ->assertJsonPath('data.version', 1);
    $this->actingAs($lene)->getJson('/api/v1/pages/'.strtoupper($child->id))->assertOk()->assertJsonPath('data.id', $child->id);
});

it('knows a page by nothing but its ULID', function () use ($world) {
    [, $mara, , $root] = $world();

    $this->actingAs($mara)->getJson("/api/v1/pages/{$root->id}")->assertOk();
    $this->actingAs($mara)->getJson('/api/v1/pages/WEB-1')->assertNotFound();
    $this->actingAs($mara)->getJson('/api/v1/pages/start')->assertNotFound();
    $this->actingAs($mara)->getJson('/api/v1/pages/01jc0000000000000000000000')->assertNotFound();
});

it('hides the wiki of a private project from someone else', function () use ($world) {
    [, , $lene] = $world();
    $ops = Project::factory()->identifier('OPS')->private()->create();
    $page = Page::factory()->create(['project_id' => $ops->id]);
    $admin = User::factory()->admin()->create();

    $this->actingAs($admin)->getJson('/api/v1/projects/OPS/pages')->assertOk()->assertJsonPath('meta.total', 1);
    $this->actingAs($admin)->getJson("/api/v1/pages/{$page->id}")->assertOk();
    $this->actingAs($lene)->getJson('/api/v1/projects/OPS/pages')->assertNotFound()->assertJsonMissingPath('detail');
    $this->actingAs($lene)->getJson("/api/v1/pages/{$page->id}")->assertNotFound()->assertJsonMissingPath('detail');
});

it('lets a read-only token read the tree and a page', function () use ($world) {
    [, , $lene, $root] = $world();
    $token = apiToken($lene, ['read']);

    $this->withToken($token)->getJson('/api/v1/projects/WEB/pages')->assertOk()->assertJsonPath('meta.total', 2);
    $this->withToken($token)->getJson("/api/v1/pages/{$root->id}")->assertOk()->assertJsonPath('data.content', 'Willkommen');
});
