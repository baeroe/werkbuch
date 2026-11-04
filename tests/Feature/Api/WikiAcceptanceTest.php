<?php

use App\Access\ProjectRole;
use App\Enums\Locale;
use App\Models\Page;
use App\Models\PageVersion;
use App\Models\Project;
use App\Models\User;
use App\Search\SearchConsumer;

/*
 * The acceptance of phase 9 over REST (Flow 5 "in REST"): a token of Mara writes a page in Markdown with a reference to
 * another page and a mention, Erik reads it as Markdown and as JSON, saves on an outdated base and meets the conflict
 * (409 `page_conflict` with the current page), then saves without a base and keeps Mara's version as a version (A308).
 * He moves the page under another one and deletes that page with its subtree; the search finds the page before and no
 * longer after (the consumer `search` writes the index, `searchEngine()`).
 */

$world = function (): array {
    searchEngine();
    consumers(SearchConsumer::class);

    $erik = User::factory()->create(['name' => 'Erik Ende', 'handle' => 'erik', 'locale' => Locale::En]);
    $web = Project::factory()->identifier('WEB')->private()->member($erik, ProjectRole::Admin)->create(['lead_id' => $erik->id]);
    $mara = memberOf($web, ProjectRole::Member, ['name' => 'Mara Lindqvist', 'handle' => 'mara', 'locale' => Locale::De]);
    $plan = Page::factory()->withText('Wer macht was')->create(['project_id' => $web->id, 'title' => 'Plan', 'created_by' => $erik->id, 'updated_by' => $erik->id]);

    return ['erik' => $erik, 'mara' => $mara, 'web' => $web, 'plan' => $plan];
};

it('writes, reads, meets the conflict, keeps the other version, moves and deletes a page over REST', function () use ($world) {
    $w = $world();
    $mara = apiToken($w['mara'], ['read', 'write']);
    $erik = apiToken($w['erik'], ['read', 'write']);
    $plan = $w['plan'];

    // Mara writes Markdown: the page link and the handle become nodes
    $created = $this->withToken($mara)->postJson('/api/v1/projects/WEB/pages', [
        'title' => 'Onboarding',
        'content' => "Siehe [Plan](page:{$plan->id}) und frag @erik.",
    ])->assertCreated()
        ->assertJsonPath('data.version', 1)
        ->assertJsonPath('data.created_by', $w['mara']->id);
    $id = $created->json('data.id');

    // Erik reads it: Markdown for him, and the stored JSON with a reference to the page and a mention of him
    forgetApiAuth();
    $read = $this->withToken($erik)->getJson("/api/v1/pages/{$id}")->assertOk()
        ->assertJsonPath('data.content', "Siehe [Plan](page:{$plan->id}) und frag @erik.");
    $nodes = collect($read->json('data.content_json.content.0.content'));
    expect($nodes->firstWhere('type', 'reference')['attrs'])->toMatchArray(['id' => $plan->id, 'kind' => 'page', 'label' => null])
        ->and($nodes->firstWhere('type', 'mention')['attrs'])->toMatchArray(['id' => $w['erik']->id, 'label' => 'erik']);

    // the search finds the page by its title and its text
    $this->getJson('/api/v1/search?q=onboarding&types=pages')->assertOk()->assertJsonPath('data.pages.0.id', $id);
    $this->getJson('/api/v1/search?q=frag&types=pages')->assertOk()->assertJsonPath('data.pages.0.id', $id);

    // Mara saves on her version 1; her own state of a minute ago is no version (A307)
    forgetApiAuth();
    $this->withToken($mara)->patchJson("/api/v1/pages/{$id}", ['content' => 'Fassung von Mara', 'base_version' => 1])->assertOk()
        ->assertJsonPath('data.version', 2);

    // Erik saves on version 1: refused, with the page as it is now, in his language
    forgetApiAuth();
    $this->withToken($erik)->patchJson("/api/v1/pages/{$id}", ['content' => 'Fassung von Erik', 'base_version' => 1])
        ->assertStatus(409)
        ->assertJsonPath('reason', 'page_conflict')
        ->assertJsonPath('detail', __('problem.detail.page_conflict', ['name' => 'Mara Lindqvist'], 'en'))
        ->assertJsonPath('current.version', 2)
        ->assertJsonPath('current.content', 'Fassung von Mara')
        ->assertJsonPath('current.updated_by', $w['mara']->id);
    expect(Page::query()->findOrFail($id)->content_text)->toBe('Fassung von Mara');

    // without a base the save goes through, and Mara's version is kept before Erik's replaces it
    $this->patchJson("/api/v1/pages/{$id}", ['content' => 'Fassung von Erik'])->assertOk()
        ->assertJsonPath('data.version', 3)
        ->assertJsonPath('data.content', 'Fassung von Erik')
        ->assertJsonPath('data.updated_by', $w['erik']->id);
    $versions = $this->getJson("/api/v1/pages/{$id}/versions")->assertOk()
        ->assertJsonPath('meta.total', 1)
        ->assertJsonPath('data.0.version', 2)
        ->assertJsonPath('data.0.author_id', $w['mara']->id);
    $this->getJson("/api/v1/pages/{$id}/versions/{$versions->json('data.0.id')}")->assertOk()
        ->assertJsonPath('data.content', 'Fassung von Mara');

    // moved under Plan: its place changes, its version does not
    $this->postJson("/api/v1/pages/{$id}/move", ['parent_id' => $plan->id, 'before_id' => null])->assertOk()
        ->assertJsonPath('data.parent_id', $plan->id)
        ->assertJsonPath('data.version', 3);
    $this->getJson('/api/v1/projects/WEB/pages')->assertOk()
        ->assertJsonPath('meta.total', 2)
        ->assertJsonPath('data.0.id', $plan->id)
        ->assertJsonPath('data.0.children.0.id', $id);
    $this->getJson('/api/v1/search?q=onboarding&types=pages')->assertJsonPath('data.pages.0.id', $id);

    // Plan goes with its subtree: two pages, their versions, and their documents in the index
    $this->deleteJson("/api/v1/pages/{$plan->id}")->assertOk()->assertExactJson(['deleted' => 2]);
    $this->getJson("/api/v1/pages/{$id}")->assertNotFound();
    $this->getJson('/api/v1/projects/WEB/pages')->assertOk()->assertJsonPath('meta.total', 0);
    expect(PageVersion::query()->where('page_id', $id)->exists())->toBeFalse();
    $this->getJson('/api/v1/search?q=onboarding&types=pages')->assertOk()->assertJsonPath('data.pages', []);
    $this->getJson('/api/v1/search?q=frag&types=pages')->assertOk()->assertJsonPath('data.pages', []);
});

it('lets nobody outside the private project read the page or find it', function () use ($world) {
    $w = $world();
    $ida = User::factory()->create(['name' => 'Ida', 'handle' => 'ida']);
    $id = $this->withToken(apiToken($w['mara'], ['read', 'write']))->postJson('/api/v1/projects/WEB/pages', ['title' => 'Onboarding'])->assertCreated()->json('data.id');

    forgetApiAuth();
    $token = apiToken($ida, ['read']);
    $this->withToken($token)->getJson("/api/v1/pages/{$id}")->assertNotFound()->assertJsonMissingPath('detail');
    $this->withToken($token)->getJson('/api/v1/search?q=onboarding&types=pages')->assertOk()->assertJsonPath('data.pages', []);
});
