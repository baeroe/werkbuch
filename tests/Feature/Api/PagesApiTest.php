<?php

use App\Access\ProjectRole;
use App\Models\Page;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use App\RichText\Document;
use App\Support\PageItemReferences;
use Tests\Support\RichTextFixtures as F;

/*
 * The wiki over REST, reading (Task 3): `GET /api/v1/projects/{project}/pages` (the whole tree without text, A315) and
 * `GET /api/v1/pages/{page}` (`{page}` by its ULID only); the pages that name an item (Task 21u, A456,
 * `GET /api/v1/work-items/{item}/pages`). WEB (public) with Mara as its admin and Lene as a viewer.
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

it('creates a page with 201 and saves it with its base version', function () use ($world) {
    [$web, $mara, , $root] = $world();

    $created = $this->actingAs($mara)->postJson('/api/v1/projects/web/pages', ['title' => 'Glossar', 'parent_id' => $root->id, 'content' => 'Begriffe'])
        ->assertCreated()
        ->assertJsonPath('data.title', 'Glossar')
        ->assertJsonPath('data.parent_id', $root->id)
        ->assertJsonPath('data.content', 'Begriffe')
        ->assertJsonPath('data.version', 1);
    $id = $created->json('data.id');

    $this->actingAs($mara)->patchJson("/api/v1/pages/{$id}", ['content' => 'Begriffe und mehr', 'base_version' => 1])->assertOk()
        ->assertJsonPath('data.content', 'Begriffe und mehr')
        ->assertJsonPath('data.version', 2)
        ->assertJsonPath('data.title', 'Glossar');

    expect(Page::query()->findOrFail($id)->project_id)->toBe($web->id);
});

it('answers a save on an outdated base with 409 page_conflict and the current page', function () use ($world) {
    [, $mara, , $root] = $world();
    $erik = memberOf($root->project, ProjectRole::Member, ['name' => 'Erik']);
    $this->actingAs($mara)->patchJson("/api/v1/pages/{$root->id}", ['content' => 'Fassung von Mara', 'base_version' => 1])->assertOk();

    $this->actingAs($erik)->patchJson("/api/v1/pages/{$root->id}", ['content' => 'Fassung von Erik', 'base_version' => 1])
        ->assertStatus(409)
        ->assertHeader('Content-Type', 'application/problem+json')
        ->assertJsonPath('reason', 'page_conflict')
        ->assertJsonPath('detail', __('problem.detail.page_conflict', ['name' => 'Mara']))
        ->assertJsonPath('current.version', 2)
        ->assertJsonPath('current.content', 'Fassung von Mara');
});

it('refuses a viewer and wrong fields over REST', function () use ($world) {
    [, $mara, $lene, $root] = $world();

    $this->actingAs($lene)->postJson('/api/v1/projects/web/pages', ['title' => 'Neu'])->assertForbidden()
        ->assertJsonPath('detail', __('problem.detail.wiki_members_only'));
    $this->actingAs($mara)->patchJson("/api/v1/pages/{$root->id}", ['title' => '', 'base_version' => 'zwei'])->assertUnprocessable()
        ->assertJsonPath('errors.title.0', __('field.title.required'))
        ->assertJsonPath('errors.base_version.0', __('field.base_version.invalid'));
});

it('moves a page with its place in the answer and refuses a cycle at parent_id', function () use ($world) {
    [, $mara, $lene, $root, $child] = $world();

    $this->actingAs($mara)->postJson("/api/v1/pages/{$child->id}/move", ['parent_id' => null, 'before_id' => strtoupper($root->id)])->assertOk()
        ->assertJsonPath('data.id', $child->id)
        ->assertJsonPath('data.parent_id', null)
        ->assertJsonPath('data.version', 1)
        ->assertJsonPath('data.content', 'Wie wir arbeiten');
    expect(strcmp((string) $child->fresh()?->rank, $root->rank))->toBeLessThan(0);

    $this->actingAs($mara)->postJson("/api/v1/pages/{$root->id}/move", ['parent_id' => $root->id, 'before_id' => null])->assertUnprocessable()
        ->assertJsonPath('errors.parent_id.0', __('field.parent_page.cycle'));
    $this->actingAs($mara)->postJson("/api/v1/pages/{$root->id}/move", [])->assertUnprocessable()
        ->assertJsonPath('errors.parent_id.0', __('field.required'))
        ->assertJsonPath('errors.before_id.0', __('field.required'));
    $this->actingAs($lene)->postJson("/api/v1/pages/{$root->id}/move", ['parent_id' => null, 'before_id' => null])->assertForbidden()
        ->assertJsonPath('detail', __('problem.detail.wiki_members_only'));
});

/** A page of the project whose text references the item, recorded as CreatePage records it. */
$naming = function (Project $project, string $title, WorkItem $item): Page {
    $page = Page::factory()->create(['project_id' => $project->id, 'title' => $title, 'content' => F::doc(F::p('Siehe ', F::reference($item->id)))]);
    PageItemReferences::sync($page, Document::fromJson($page->content));

    return $page;
};

it('lists the pages that name an item, lean, with the envelope of a list', function () use ($world, $naming) {
    [$web, $mara, $lene] = $world();
    $item = WorkItem::factory()->for($web)->create(['created_by' => $mara->id]);
    $plan = $naming($web, 'Plan', $item);
    $naming($web, 'Ablaufplan', $item);
    $ops = Project::factory()->identifier('OPS')->private()->member($mara, ProjectRole::Admin)->create();
    $naming($ops, 'Geheim', $item);

    $response = $this->actingAs($lene)->getJson("/api/v1/work-items/{$item->key}/pages?per_page=1")->assertOk()
        ->assertJsonPath('data.0.title', 'Ablaufplan')
        ->assertJsonPath('meta.total', 2)
        ->assertJsonPath('meta.per_page', 1);
    $next = $this->actingAs($lene)->getJson((string) $response->json('links.next'))->assertOk()
        ->assertJsonPath('data.0.id', $plan->id)
        ->assertJsonPath('data.0.project_id', $web->id)
        ->assertJsonPath('meta.next_cursor', null);

    expect(array_keys($response->json()))->toBe(['data', 'links', 'meta'])
        ->and(array_keys($next->json('data.0')))->not->toContain('content')
        ->and(array_keys($next->json('data.0')))->not->toContain('content_json')
        ->and((string) json_encode($response->json()).json_encode($next->json()))->not->toContain('Geheim')
        ->and($this->actingAs($mara)->getJson("/api/v1/work-items/{$item->id}/pages")->assertOk()->json('meta.total'))->toBe(3);
    $this->actingAs($lene)->getJson("/api/v1/work-items/{$item->key}/pages?sort=title")->assertUnprocessable();
});

it('answers the pages of an item nobody shows the reader with 404 and lets a read token list them', function () use ($world, $naming) {
    [$web, $mara, $lene] = $world();
    $ops = Project::factory()->identifier('OPS')->private()->member($mara, ProjectRole::Admin)->create();
    $secret = WorkItem::factory()->for($ops)->create(['created_by' => $mara->id]);
    $item = WorkItem::factory()->for($web)->create(['created_by' => $mara->id]);
    $naming($web, 'Plan', $item);

    $this->actingAs($lene)->getJson("/api/v1/work-items/{$secret->key}/pages")->assertNotFound()->assertJsonMissingPath('detail');
    $this->actingAs($lene)->getJson('/api/v1/work-items/NOPE-1/pages')->assertNotFound()->assertJsonMissingPath('detail');
    $this->withToken(apiToken($lene, ['read']))->getJson("/api/v1/work-items/{$item->key}/pages")->assertOk()->assertJsonPath('meta.total', 1);
});

it('redirects the pages of a former key with 301', function () use ($world, $naming) {
    [$web, $mara, $lene] = $world();
    $item = WorkItem::factory()->for($web)->create(['created_by' => $mara->id]);
    $naming($web, 'Plan', $item);
    $web->update(['identifier' => 'NEW']);
    $web->identifiers()->create(['identifier' => 'WEB']);

    $this->actingAs($lene)->getJson("/api/v1/work-items/WEB-{$item->number}/pages?per_page=5")->assertStatus(301)
        ->assertHeader('Location', url("/api/v1/work-items/NEW-{$item->number}/pages").'?per_page=5');
    $this->actingAs($lene)->getJson("/api/v1/work-items/NEW-{$item->number}/pages")->assertOk()->assertJsonPath('data.0.title', 'Plan');
});
