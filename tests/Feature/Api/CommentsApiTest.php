<?php

use App\Access\ProjectRole;
use App\Models\Comment;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use Tests\Support\RichTextFixtures as F;

/*
 * The comments over REST (Task 9): `GET|POST /api/v1/work-items/{item}/comments`, `GET|PATCH|DELETE
 * /api/v1/comments/{comment}`. WEB (public) with Mara as its admin and Lene as a viewer.
 */

$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara', 'handle' => 'mara']);
    $web = Project::factory()->identifier('WEB')->public()->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $lene = memberOf($web, ProjectRole::Viewer, ['name' => 'Lene', 'handle' => 'lene']);
    $item = WorkItem::factory()->for($web)->create(['created_by' => $mara->id]);

    return [$web, $mara, $lene, $item];
};

it('adds a comment in Markdown or JSON and answers 201 with the comment', function () use ($world) {
    [, $mara, $lene] = $world();

    $created = $this->actingAs($lene)->postJson('/api/v1/work-items/web-1/comments', ['body' => 'Danke @mara!'])->assertCreated()
        ->assertJsonPath('data.author_id', $lene->id)
        ->assertJsonPath('data.body', 'Danke @mara!')
        ->assertJsonPath('data.body_json', F::doc(F::p('Danke ', F::mention($mara->id, 'mara'), '!')))
        ->assertJsonPath('data.edited_at', null)
        ->assertJsonPath('data.reactions', []);
    $json = $this->actingAs($lene)->postJson('/api/v1/work-items/WEB-1/comments', ['body_json' => F::doc(F::p('  zwei  Leerzeichen '))])->assertCreated();

    expect(array_keys($created->json('data')))->toBe(['id', 'work_item_id', 'author_id', 'body', 'body_json', 'created_at', 'edited_at', 'reactions'])
        // the spaces of a text node in JSON stay (RichTextInput::RAW_KEYS)
        ->and($json->json('data.body_json'))->toBe(F::doc(F::p('  zwei  Leerzeichen ')));
});

it('lists the comments of an item as a page', function () use ($world) {
    [, $mara, $lene, $item] = $world();
    $this->actingAs($mara)->postJson('/api/v1/work-items/WEB-1/comments', ['body' => 'eins'])->assertCreated();
    $this->actingAs($lene)->postJson('/api/v1/work-items/WEB-1/comments', ['body' => 'zwei'])->assertCreated();

    $this->withToken(apiToken($lene, ['read']))->getJson('/api/v1/work-items/WEB-1/comments?per_page=1')->assertOk()
        ->assertJsonPath('data.0.body', 'eins')
        ->assertJsonPath('meta.total', 2)
        ->assertJsonPath('meta.per_page', 1)
        ->assertJsonPath('data.0.work_item_id', $item->id);
});

it('shows, edits and deletes a comment by its ULID in any case', function () use ($world) {
    [, , $lene] = $world();
    $id = $this->actingAs($lene)->postJson('/api/v1/work-items/WEB-1/comments', ['body' => 'Endwurf'])->json('data.id');
    $upper = strtoupper($id);

    $this->actingAs($lene)->getJson("/api/v1/comments/{$upper}")->assertOk()->assertJsonPath('data.id', $id);
    $this->actingAs($lene)->patchJson("/api/v1/comments/{$upper}", ['body' => 'Entwurf'])->assertOk()
        ->assertJsonPath('data.body', 'Entwurf')
        ->assertJsonPath('data.edited_at', fn (?string $stamp) => $stamp !== null);
    $this->actingAs($lene)->deleteJson("/api/v1/comments/{$upper}")->assertNoContent();

    expect(Comment::query()->count())->toBe(0);
    $this->actingAs($lene)->getJson("/api/v1/comments/{$id}")->assertNotFound();
    $this->actingAs($lene)->getJson('/api/v1/comments/kein-kommentar')->assertNotFound();
});

it('refuses with the reasons of the rules', function () use ($world) {
    [$web, $mara, $lene] = $world();
    $id = $this->actingAs($lene)->postJson('/api/v1/work-items/WEB-1/comments', ['body' => 'Meins'])->json('data.id');

    $this->actingAs($lene)->postJson('/api/v1/work-items/WEB-1/comments', ['body' => '   '])->assertUnprocessable()
        ->assertJsonPath('errors.body.0', __('field.body.required'));
    $this->actingAs($mara)->patchJson("/api/v1/comments/{$id}", ['body' => 'Fremd'])->assertForbidden()
        ->assertJsonPath('detail', __('problem.detail.comment_author_only'));
    $this->actingAs(memberOf($web, ProjectRole::Member))->deleteJson("/api/v1/comments/{$id}")->assertForbidden()
        ->assertJsonPath('detail', __('problem.detail.comment_delete_admins_only'));
    forgetApiAuth();
    $this->withToken(apiToken($lene, ['read']))->postJson('/api/v1/work-items/WEB-1/comments', ['body' => 'Lesen'])->assertForbidden();
});

it('hides the comments of a private project with 404', function () use ($world) {
    [, , $lene] = $world();
    $ops = Project::factory()->identifier('OPS')->private()->create();
    $comment = Comment::factory()->for(WorkItem::factory()->for($ops), 'workItem')->create();

    $this->actingAs($lene)->getJson('/api/v1/work-items/OPS-1/comments')->assertNotFound()->assertJsonMissingPath('detail');
    $this->actingAs($lene)->postJson('/api/v1/work-items/OPS-1/comments', ['body' => 'Hallo'])->assertNotFound();
    $this->actingAs($lene)->getJson("/api/v1/comments/{$comment->id}")->assertNotFound()->assertJsonMissingPath('detail');
});

it('redirects the comments of a former key with 301 and writes through it without one', function () use ($world) {
    [$web, , $lene] = $world();
    $web->update(['identifier' => 'NEW']);
    $web->identifiers()->create(['identifier' => 'WEB']);

    $this->actingAs($lene)->getJson('/api/v1/work-items/WEB-1/comments?per_page=5')->assertStatus(301)
        ->assertHeader('Location', url('/api/v1/work-items/NEW-1/comments').'?per_page=5');
    $this->actingAs($lene)->postJson('/api/v1/work-items/WEB-1/comments', ['body' => 'Alt'])->assertCreated();
});
