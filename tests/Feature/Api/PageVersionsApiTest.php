<?php

use App\Access\ProjectRole;
use App\Models\Page;
use App\Models\PageVersion;
use App\Models\Project;
use App\Models\User;
use Illuminate\Pagination\Cursor;
use Tests\Support\RichTextFixtures as F;

/*
 * The versions of a page over REST (Task 7, A315): `GET /api/v1/pages/{page}/versions` (newest first, a page at a time,
 * without text), `GET …/versions/{pageVersion}` (with Markdown and JSON) and `POST …/versions/{pageVersion}/restore`
 * (`{data: Page}`); `{pageVersion}` by its ULID only. WEB (public) with Mara as its admin and Lene as a viewer.
 */

$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara', 'handle' => 'mara']);
    $web = Project::factory()->identifier('WEB')->public()->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $lene = memberOf($web, ProjectRole::Viewer, ['name' => 'Lene', 'handle' => 'lene']);
    $page = Page::factory()->withText('Dritte Fassung')->create(['project_id' => $web->id, 'title' => 'Ablauf', 'version' => 3, 'updated_by' => $mara->id]);
    $versions = collect([1, 2])->map(fn (int $n) => PageVersion::factory()->create([
        'page_id' => $page->id, 'version' => $n, 'title' => "Ablauf {$n}", 'content' => F::doc(F::p("Fassung {$n}")),
        'author_id' => $mara->id, 'created_at' => now()->subHours(5 - $n),
    ]));

    return [$mara, $lene, $page, $versions[0], $versions[1]];
};

it('lists the versions newest first without text and pages with a cursor', function () use ($world) {
    [, $lene, $page, $first, $second] = $world();

    $all = $this->actingAs($lene)->getJson("/api/v1/pages/{$page->id}/versions")->assertOk()
        ->assertJsonPath('data.0.id', $second->id)
        ->assertJsonPath('data.1.id', $first->id)
        ->assertJsonPath('meta.total', 2);
    expect(array_keys($all->json()))->toBe(['data', 'links', 'meta'])
        ->and(array_keys($all->json('data.0')))->toBe(['id', 'page_id', 'version', 'title', 'author_id', 'created_at']);

    $one = $this->actingAs($lene)->getJson("/api/v1/pages/{$page->id}/versions?per_page=1")->assertOk()
        ->assertJsonPath('data.0.version', 2)
        ->assertJsonCount(1, 'data');
    $this->actingAs($lene)->getJson("/api/v1/pages/{$page->id}/versions?per_page=1&cursor=".$one->json('meta.next_cursor'))->assertOk()
        ->assertJsonPath('data.0.version', 1)
        ->assertJsonPath('meta.next_cursor', null);
    // a cursor of another list lacks the version
    $foreign = (new Cursor(['id' => $first->id]))->encode();
    $this->actingAs($lene)->getJson("/api/v1/pages/{$page->id}/versions?cursor={$foreign}")->assertUnprocessable()
        ->assertJsonPath('errors.cursor.0', __('field.cursor.invalid'));
});

it('shows a version with Markdown and JSON, by its ULID in either case', function () use ($world) {
    [, $lene, $page, $first] = $world();

    $this->actingAs($lene)->getJson("/api/v1/pages/{$page->id}/versions/{$first->id}")->assertOk()
        ->assertJsonPath('data.id', $first->id)
        ->assertJsonPath('data.version', 1)
        ->assertJsonPath('data.content', 'Fassung 1')
        ->assertJsonPath('data.content_json', F::doc(F::p('Fassung 1')));
    $this->actingAs($lene)->getJson("/api/v1/pages/{$page->id}/versions/".strtoupper($first->id))->assertOk()->assertJsonPath('data.id', $first->id);
});

it('knows a version by nothing but its ULID, and only below its own page', function () use ($world) {
    [$mara, , $page, $first] = $world();
    $other = Page::factory()->create(['project_id' => $page->project_id]);

    $this->actingAs($mara)->getJson("/api/v1/pages/{$page->id}/versions/1")->assertNotFound();
    $this->actingAs($mara)->getJson("/api/v1/pages/{$page->id}/versions/01jc0000000000000000000000")->assertNotFound();
    $this->actingAs($mara)->getJson("/api/v1/pages/{$other->id}/versions/{$first->id}")->assertNotFound()->assertJsonMissingPath('detail');
    $this->actingAs($mara)->postJson("/api/v1/pages/{$other->id}/versions/{$first->id}/restore")->assertNotFound()->assertJsonMissingPath('detail');
});

it('restores a version and answers the page as it is now', function () use ($world) {
    [$mara, $lene, $page, $first] = $world();

    $this->actingAs($mara)->postJson("/api/v1/pages/{$page->id}/versions/{$first->id}/restore")->assertOk()
        ->assertJsonPath('data.id', $page->id)
        ->assertJsonPath('data.version', 4)
        ->assertJsonPath('data.title', 'Ablauf 1')
        ->assertJsonPath('data.content', 'Fassung 1')
        ->assertJsonPath('data.content_json', F::doc(F::p('Fassung 1')));
    $this->actingAs($lene)->getJson("/api/v1/pages/{$page->id}/versions")->assertOk()
        ->assertJsonPath('meta.total', 3)
        ->assertJsonPath('data.0.version', 3)
        ->assertJsonPath('data.0.title', 'Ablauf');
    $this->actingAs($lene)->postJson("/api/v1/pages/{$page->id}/versions/{$first->id}/restore")->assertForbidden()
        ->assertJsonPath('detail', __('problem.detail.wiki_members_only'));
});

it('lets a read-only token read the versions but not restore one', function () use ($world) {
    [, $lene, $page, $first] = $world();
    $token = apiToken($lene, ['read']);

    $this->withToken($token)->getJson("/api/v1/pages/{$page->id}/versions")->assertOk()->assertJsonPath('meta.total', 2);
    $this->withToken($token)->getJson("/api/v1/pages/{$page->id}/versions/{$first->id}")->assertOk()->assertJsonPath('data.content', 'Fassung 1');
    $this->withToken($token)->postJson("/api/v1/pages/{$page->id}/versions/{$first->id}/restore")->assertForbidden();
});
