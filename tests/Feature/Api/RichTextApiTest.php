<?php

use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Domain\Properties\FieldType;
use App\Models\Attachment;
use App\Models\Page;
use App\Models\Project;
use App\Models\Property;
use App\Models\User;
use App\Models\WorkItem;
use App\Models\WorkItemType;
use Tests\Support\RichTextFixtures as F;

/*
 * Markdown from outside over REST (Review Focus 5, Task 8): WEB (public) with Mara as its admin and Lene as a member,
 * OPS (private) with an item only the org admin Erik sees, Ida in the organization only.
 */

$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara', 'handle' => 'mara']);
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $lene = memberOf($web, ProjectRole::Member, ['name' => 'Lene', 'handle' => 'lene']);
    $erik = User::factory()->admin()->create(['name' => 'Erik', 'handle' => 'erik']);
    User::factory()->create(['handle' => 'ida']);
    $ops = Project::factory()->identifier('OPS')->private()->create();
    $secret = WorkItem::factory()->for($ops)->create(['title' => 'Geheimer Umzug']);
    $item = WorkItem::factory()->for($web)->create(['title' => 'Formular prüfen', 'created_by' => $mara->id]);

    return compact('mara', 'web', 'lene', 'erik', 'ops', 'secret', 'item');
};

it('mentions nobody inside code or a link text', function () use ($world) {
    $w = $world();

    $this->actingAs($w['mara'])->patchJson("/api/v1/work-items/{$w['item']->key}", [
        'description' => "Siehe `@lene` und [@lene](https://example.com)\n\n```\n@lene WEB-1\n```",
    ])->assertOk();

    expect($w['item']->fresh()?->description)->not->toBeNull()
        ->and(json_encode($w['item']->fresh()?->description))->not->toContain('"mention"')
        ->and(json_encode($w['item']->fresh()?->description))->not->toContain('"reference"');
});

it('leaves a foreign handle as text', function () use ($world) {
    $w = $world();

    $this->actingAs($w['mara'])->patchJson("/api/v1/work-items/{$w['item']->key}", ['description' => '@ida und @lene und @niemand'])->assertOk()
        ->assertJsonPath('data.description_json', F::doc(F::p('@ida und ', F::mention($w['lene']->id, 'lene'), ' und @niemand')))
        ->assertJsonPath('data.description', '\@ida und @lene und \@niemand');
});

it('makes no reference of the key of an invisible item', function () use ($world) {
    $w = $world();

    $this->actingAs($w['mara'])->patchJson("/api/v1/work-items/{$w['item']->key}", [
        'description' => "OPS-1 und [Umzug](item:{$w['secret']->id}) und WEB-1",
    ])->assertOk()
        ->assertJsonPath('data.description_json', F::doc(F::p('OPS-1 und Umzug und ', F::reference($w['item']->id))));
});

it('answers 422 for an attachment of another project', function () use ($world) {
    $w = $world();
    $foreign = Attachment::factory()->create(['project_id' => $w['ops']->id, 'uploaded_by' => $w['mara']->id]);
    $property = Property::factory()->create(['key' => 'notes', 'label' => 'Notizen', 'field_type' => FieldType::RichText]);
    WorkItemType::query()->where('name', 'Task')->firstOrFail()->typeProperties()->create(['property_id' => $property->id, 'required' => false, 'position' => 9]);

    $this->actingAs($w['mara'])->patchJson("/api/v1/work-items/{$w['item']->key}", ['description' => "![Plan](attachment:{$foreign->id})"])
        ->assertUnprocessable()->assertJsonPath('errors', ['description' => [__('field.rich_text.attachment')]]);
    $this->actingAs($w['mara'])->patchJson("/api/v1/work-items/{$w['item']->key}", ['values' => ['notes' => F::doc(F::p(F::file($foreign->id, 'a.pdf')))]])
        ->assertUnprocessable()->assertJsonPath('errors', ['values.notes' => [__('field.rich_text.attachment')]]);

    expect($foreign->fresh()?->attachable_id)->toBeNull()
        ->and($w['item']->fresh()?->description)->toBeNull();
});

it('writes a hidden reference as [hidden](item:…) for a reader who does not see it and as the key for one who does', function () use ($world) {
    $w = $world();
    $property = Property::factory()->create(['key' => 'notes', 'label' => 'Notizen', 'field_type' => FieldType::RichText]);
    WorkItemType::query()->where('name', 'Task')->firstOrFail()->typeProperties()->create(['property_id' => $property->id, 'required' => false, 'position' => 9]);

    $this->actingAs($w['erik'])->patchJson("/api/v1/work-items/{$w['item']->key}", ['description' => 'Wie OPS-1, siehe @lene', 'values' => ['notes' => 'OPS-1']])
        ->assertOk()->assertJsonPath('data.description', 'Wie OPS-1, siehe @lene')->assertJsonPath('data.values_markdown.notes', 'OPS-1');
    $w['lene']->update(['handle' => 'lene-neu']);

    $this->actingAs($w['lene'])->getJson("/api/v1/work-items/{$w['item']->key}")->assertOk()
        ->assertJsonPath('data.description', "Wie [hidden](item:{$w['secret']->id}), siehe @lene-neu")
        ->assertJsonPath('data.values_markdown.notes', "[hidden](item:{$w['secret']->id})");
    $this->actingAs($w['erik'])->getJson("/api/v1/work-items/{$w['item']->key}")->assertOk()
        ->assertJsonPath('data.description', 'Wie OPS-1, siehe @lene-neu');
});

it('shows no key and no title of a hidden reference in description_json', function () use ($world) {
    $w = $world();

    $this->actingAs($w['erik'])->patchJson("/api/v1/work-items/{$w['item']->key}", ['description_json' => F::doc(F::p(
        ['type' => 'reference', 'attrs' => ['id' => $w['secret']->id, 'kind' => 'item', 'label' => 'OPS-1 Geheimer Umzug']],
    ))])->assertOk();

    $json = $this->actingAs($w['lene'])->getJson("/api/v1/work-items/{$w['item']->key}")->assertOk()
        ->assertJsonPath('data.description_json', F::doc(F::p(F::reference($w['secret']->id))))->getContent();

    expect($json)->not->toContain('OPS-1')->not->toContain('Geheim');
});

it('leaves a page Ida does not see as text and writes a page with its current title for a reader who sees it', function () use ($world) {
    $w = $world();
    $ida = User::query()->where('handle', 'ida')->sole();
    app(RoleAssignments::class)->setProjectRole($ida, $w['web'], ProjectRole::Member);
    $plan = Page::factory()->for($w['ops'])->create(['title' => 'Umzugsplan']);
    $handbook = Page::factory()->for($w['web'])->create(['title' => 'Handbuch']);

    $this->actingAs($ida)->patchJson("/api/v1/work-items/{$w['item']->key}", [
        'description' => "[Plan](page:{$plan->id}) und [Seite](page:{$handbook->id})",
    ])->assertOk()
        ->assertJsonPath('data.description_json', F::doc(F::p('Plan und ', F::reference($handbook->id, 'page'))))
        ->assertJsonPath('data.description', "Plan und [Handbuch](page:{$handbook->id})");
    $handbook->update(['title' => 'Handbuch *neu*']);

    $this->actingAs($w['mara'])->getJson("/api/v1/work-items/{$w['item']->key}")->assertOk()
        ->assertJsonPath('data.description', "Plan und [Handbuch \\*neu\\*](page:{$handbook->id})");
});

it('writes a page only the writer sees as [hidden](page:…) for others and keeps it when they write it back', function () use ($world) {
    $w = $world();
    $plan = Page::factory()->for($w['ops'])->create(['title' => 'Umzugsplan']);

    $this->actingAs($w['erik'])->patchJson("/api/v1/work-items/{$w['item']->key}", ['description' => "Siehe [x](page:{$plan->id})"])
        ->assertOk()->assertJsonPath('data.description', "Siehe [Umzugsplan](page:{$plan->id})");

    $read = $this->actingAs($w['mara'])->getJson("/api/v1/work-items/{$w['item']->key}")->assertOk()
        ->assertJsonPath('data.description', "Siehe [hidden](page:{$plan->id})");
    expect($read->getContent())->not->toContain('Umzugsplan');

    $this->actingAs($w['mara'])->patchJson("/api/v1/work-items/{$w['item']->key}", ['description' => $read->json('data.description').'!'])->assertOk()
        ->assertJsonPath('data.description_json', F::doc(F::p('Siehe ', F::reference($plan->id, 'page'), '!')));
});

it('keeps a kept mention of a former member through Markdown', function () use ($world) {
    $w = $world();
    $this->actingAs($w['mara'])->patchJson("/api/v1/work-items/{$w['item']->key}", ['description' => 'Frag @lene'])->assertOk();
    app(RoleAssignments::class)->removeFromProject($w['lene'], $w['web']);

    $markdown = $this->actingAs($w['mara'])->getJson("/api/v1/work-items/{$w['item']->key}")->json('data.description');
    $this->actingAs($w['mara'])->patchJson("/api/v1/work-items/{$w['item']->key}", ['description' => "{$markdown}!"])->assertOk()
        ->assertJsonPath('data.description_json', F::doc(F::p('Frag ', F::mention($w['lene']->id, 'lene'), '!')));
});

it('refuses a rich text value under another spelling of its key with 422, never 500 (T8-M5)', function () use ($world) {
    $w = $world();
    $property = Property::factory()->create(['key' => 'notes', 'label' => 'Notizen', 'field_type' => FieldType::RichText]);
    WorkItemType::query()->where('name', 'Task')->firstOrFail()->typeProperties()->create(['property_id' => $property->id, 'required' => false, 'position' => 9]);
    $unknown = fn (string $key) => [__('field.values.unknown', ['key' => $key, 'type' => 'Task'])];

    $this->actingAs($w['mara'])->patchJson("/api/v1/work-items/{$w['item']->key}", ['values' => ['NOTES' => 'Wichtig']])
        ->assertUnprocessable()->assertJsonPath('errors', ['values.NOTES' => $unknown('NOTES')]);
    $this->actingAs($w['mara'])->postJson('/api/v1/work-items', ['project_id' => 'WEB', 'title' => 'Neu', 'values' => ['Notes' => F::doc(F::p('Wichtig'))]])
        ->assertUnprocessable()->assertJsonPath('errors', ['values.Notes' => $unknown('Notes')]);
    // the exact key is read, only the other spelling is refused
    $this->actingAs($w['mara'])->patchJson("/api/v1/work-items/{$w['item']->key}", ['values' => ['notes' => 'Wichtig', 'NOTES' => 'Auch']])
        ->assertUnprocessable()->assertJsonPath('errors', ['values.NOTES' => $unknown('NOTES')]);

    expect($w['item']->fresh()?->values()->count())->toBe(0);
});
