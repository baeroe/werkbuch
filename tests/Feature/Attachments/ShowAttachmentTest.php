<?php

use App\Access\ProjectRole;
use App\Actions\Attachments\UploadAttachment;
use App\Models\Attachment;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

beforeEach(function () {
    Storage::fake('local');
});

/** Uploads through the action: the content as given, its type read from it. */
$stored = fn (User $user, Project $project, string $name, string $content, ?WorkItem $item = null) => UploadAttachment::run(
    actor($user),
    ['project_id' => $project->id, 'kind' => $item === null ? 'inline' : 'file', 'work_item_id' => $item?->id],
    UploadedFile::fake()->createWithContent($name, $content),
);

$png = fn () => (string) base64_decode(explode(',', imageDataUrl())[1]);

it('serves a PNG inline with nosniff and the sandbox', function () use ($stored, $png) {
    $project = Project::factory()->create();
    $mara = memberOf($project, ProjectRole::Member);
    $attachment = $stored($mara, $project, 'skizze.png', $png());

    $response = $this->actingAs($mara)->get("/attachments/{$attachment->id}")->assertOk()
        ->assertHeader('Content-Type', 'image/png')
        ->assertHeader('Content-Disposition', "inline; filename*=UTF-8''skizze.png")
        ->assertHeader('X-Content-Type-Options', 'nosniff')
        ->assertHeader('Content-Security-Policy', "default-src 'none'; sandbox");

    expect($response->headers->get('Cache-Control'))->toContain('private')->toContain('max-age=3600')->not->toContain('public')
        ->and($response->baseResponse->getFile()->getPathname())->toBe($attachment->getFirstMedia('file')?->getPath());
});

it('serves an SVG and an HTML file as download, never inline', function (string $name, string $content) use ($stored) {
    $project = Project::factory()->create();
    $mara = memberOf($project, ProjectRole::Member);
    $item = WorkItem::factory()->state(['project_id' => $project->id])->create();
    $attachment = $stored($mara, $project, $name, $content, $item);

    $this->actingAs($mara)->get("/attachments/{$attachment->id}")->assertOk()
        ->assertHeader('Content-Type', 'application/octet-stream')
        ->assertHeader('Content-Disposition', "attachment; filename*=UTF-8''".rawurlencode($name))
        ->assertHeader('X-Content-Type-Options', 'nosniff')
        ->assertHeader('Content-Security-Policy', "default-src 'none'; sandbox");
})->with([
    'an SVG, sent as PNG' => ['plan.png', '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'],
    'an HTML page' => ['Übersicht (neu).html', '<!DOCTYPE html><html><body><script>alert(1)</script></body></html>'],
]);

it('serves the uploader an unowned upload and nobody else', function () use ($stored, $png) {
    $project = Project::factory()->create();
    $mara = memberOf($project, ProjectRole::Member);
    $attachment = $stored($mara, $project, 'skizze.png', $png());

    $this->actingAs($mara)->getJson("/api/v1/attachments/{$attachment->id}")->assertOk()->assertJsonPath('data.owner', null);

    foreach ([memberOf($project, ProjectRole::Admin), User::factory()->admin()->create()] as $other) {
        $this->actingAs($other)->get("/attachments/{$attachment->id}")->assertNotFound();
        $this->actingAs($other)->getJson("/api/v1/attachments/{$attachment->id}")->assertNotFound()->assertJsonMissingPath('detail');
    }
});

it('hides the image of an item from an outsider with 404', function () use ($png) {
    $ops = Project::factory()->identifier('OPS')->private()->create();
    $erik = memberOf($ops, ProjectRole::Viewer);
    $ida = User::factory()->create(['name' => 'Ida']);
    $item = WorkItem::factory()->state(['project_id' => $ops->id])->create();
    $attachment = Attachment::factory()->forItem($item)->stored($png(), 'image/png', 'karte.png')->create();

    $this->actingAs($erik)->get("/attachments/{$attachment->id}")->assertOk();
    $this->actingAs($erik)->getJson("/api/v1/attachments/{$attachment->id}")->assertOk()
        ->assertJsonPath('data.owner', ['type' => 'work_item', 'id' => $item->id])
        ->assertJsonPath('data.url', "/attachments/{$attachment->id}");

    $this->actingAs($ida)->get("/attachments/{$attachment->id}")->assertNotFound();
    $this->actingAs($ida)->get("/attachments/{$attachment->id}/preview")->assertNotFound();
    $this->actingAs($ida)->getJson("/api/v1/attachments/{$attachment->id}")->assertNotFound()->assertJsonMissingPath('detail');
});

it('hides an attachment of a project being deleted', function () use ($stored, $png) {
    $project = Project::factory()->create();
    $mara = memberOf($project, ProjectRole::Member);
    $item = WorkItem::factory()->state(['project_id' => $project->id])->create();
    $unowned = $stored($mara, $project, 'skizze.png', $png());
    $owned = $stored($mara, $project, 'liste.txt', 'Liste', $item);
    $project->forceFill(['deleting_at' => now()])->save();

    $this->actingAs($mara)->get("/attachments/{$unowned->id}")->assertNotFound();
    $this->actingAs(User::factory()->admin()->create())->get("/attachments/{$owned->id}")->assertNotFound();
});

it('hides an attachment whose owner is gone or of a kind it does not know', function () use ($png) {
    $project = Project::factory()->create();
    $admin = User::factory()->admin()->create();
    $gone = Attachment::factory()->stored($png(), 'image/png', 'a.png')->create([
        'project_id' => $project->id, 'uploaded_by' => $admin->id, 'attachable_type' => 'work_item', 'attachable_id' => strtolower((string) Str::ulid()),
    ]);
    $unknown = Attachment::factory()->stored($png(), 'image/png', 'b.png')->create([
        'project_id' => $project->id, 'uploaded_by' => $admin->id, 'attachable_type' => 'comment', 'attachable_id' => strtolower((string) Str::ulid()),
    ]);

    // the uploader as well: an owner that is named is never read as "nobody owns it"
    $this->actingAs($admin)->get("/attachments/{$gone->id}")->assertNotFound();
    $this->actingAs($admin)->get("/attachments/{$unknown->id}")->assertNotFound();
});

it('forces a download with ?download=1', function () use ($stored, $png) {
    $project = Project::factory()->create();
    $mara = memberOf($project, ProjectRole::Member);
    $attachment = $stored($mara, $project, 'skizze.png', $png());

    $this->actingAs($mara)->get("/attachments/{$attachment->id}?download=1")->assertOk()
        ->assertHeader('Content-Type', 'image/png')
        ->assertHeader('Content-Disposition', "attachment; filename*=UTF-8''skizze.png");
});

it('answers 404 for a preview that was never made and for a row without its file', function () use ($stored, $png) {
    $project = Project::factory()->create();
    $mara = memberOf($project, ProjectRole::Member);
    $attachment = $stored($mara, $project, 'skizze.png', $png());
    $empty = Attachment::factory()->create(['project_id' => $project->id, 'uploaded_by' => $mara->id]);

    $this->actingAs($mara)->get("/attachments/{$attachment->id}/preview")->assertNotFound();
    $this->actingAs($mara)->getJson("/api/v1/attachments/{$attachment->id}")->assertJsonPath('data.preview_url', null);
    $this->actingAs($mara)->get("/attachments/{$empty->id}")->assertNotFound();
});

it('reads with a bearer token with read, not with one that may only write', function () use ($stored, $png) {
    $project = Project::factory()->create();
    $mara = memberOf($project, ProjectRole::Member);
    $attachment = $stored($mara, $project, 'skizze.png', $png());

    $this->withToken(apiToken($mara, ['read']))->get("/attachments/{$attachment->id}")->assertOk()->assertHeader('Content-Type', 'image/png');
    $this->withToken(apiToken($mara, ['read']))->getJson("/api/v1/attachments/{$attachment->id}")->assertOk();
    forgetApiAuth();
    $this->withToken(apiToken($mara, ['write']))->get("/attachments/{$attachment->id}")->assertForbidden();
});

it('sends guests to the sign-in and answers an unknown attachment with 404', function () use ($stored, $png) {
    $project = Project::factory()->create();
    $mara = memberOf($project, ProjectRole::Member);
    $attachment = $stored($mara, $project, 'skizze.png', $png());

    $this->get("/attachments/{$attachment->id}")->assertRedirect('/login');
    $this->actingAs($mara)->get('/attachments/'.Str::ulid())->assertNotFound();
    $this->actingAs($mara)->get('/attachments/skizze.png')->assertNotFound();
    $this->actingAs($mara)->get('/attachments/'.Str::upper($attachment->id))->assertOk();
});

it('relates an attachment to its project, its uploader and its owner', function () {
    $item = WorkItem::factory()->create();
    $owned = Attachment::factory()->forItem($item, 'file')->create();
    $unowned = Attachment::factory()->create();

    expect($owned->project->is($item->project))->toBeTrue()
        ->and($owned->uploader->is(User::query()->find($owned->uploaded_by)))->toBeTrue()
        ->and($owned->attachable)->toBeInstanceOf(WorkItem::class)
        ->and($owned->attachable?->is($item))->toBeTrue()
        ->and($unowned->attachable)->toBeNull();
});
