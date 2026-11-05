<?php

use App\Access\ProjectRole;
use App\Actions\Attachments\PruneUnownedAttachments;
use App\Actions\Templates\DeleteTemplate;
use App\Actions\WorkItems\CreateWorkItem;
use App\Domain\Properties\FieldType;
use App\Events\EventType;
use App\Models\Attachment;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Property;
use App\Models\Template;
use App\Models\User;
use App\Models\WorkItem;
use App\Models\WorkItemType;
use App\RichText\Document;
use App\Support\Actor;
use App\Support\TemplateAttachments;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;
use Tests\Support\RichTextFixtures as F;

// Creating an item from a template (spec 4.12, A337, A352, K1, K13): the item owns copies of the template's pictures and
// files, made before any lock; the template keeps its own, and the history names the template.

beforeEach(function () {
    Storage::fake('local');
});

/** WEB with Mara as its admin, a rich text property `notes` on Task and a template of Mara. */
$world = function (): array {
    Organization::current()->update(['timezone' => 'Europe/Berlin', 'locale' => 'de']);
    $mara = User::factory()->create(['name' => 'Mara', 'handle' => 'mara']);
    $web = Project::factory()->identifier('WEB')->public()->member($mara, ProjectRole::Admin)->create();
    $task = WorkItemType::query()->where('name', 'Task')->firstOrFail();
    $notes = Property::factory()->create(['key' => 'notes', 'label' => 'Notizen', 'field_type' => FieldType::RichText]);
    $task->typeProperties()->create(['property_id' => $notes->id, 'required' => false, 'position' => 9]);
    $template = Template::factory()->create(['project_id' => $web->id, 'created_by' => $mara->id, 'name' => 'Wartung']);

    return [$web, $mara, $template];
};

/** A stored picture or file the template (or another owner) has. */
$owned = fn (Template|WorkItem $owner, string $name, string $mime, string $kind = 'inline') => ($owner instanceof Template
    ? Attachment::factory()->forTemplate($owner)
    : Attachment::factory()->forItem($owner, $kind))->stored("Inhalt {$name}", $mime, $name)->create();

$path = fn (Attachment $attachment) => (string) $attachment->getFirstMedia('file')?->getPathRelativeToRoot();

it('creates an item with copies of the template\'s images', function () use ($world, $owned, $path) {
    [$web, $mara, $template] = $world();
    $image = $owned($template, 'skizze.png', 'image/png');
    $file = $owned($template, 'plan.pdf', 'application/pdf');

    $item = CreateWorkItem::run(actor($mara), [
        'project_id' => 'WEB',
        'title' => 'Wartung KW 45',
        'template_id' => strtoupper($template->id),
        'description_json' => F::doc(F::p(F::text('Für '), F::mention($mara->id, 'mara')), F::image($image->id, 'Skizze')),
        'values' => ['notes' => F::doc(F::p(F::file($file->id, 'plan.pdf')))],
    ]);

    $description = Document::fromJson((array) $item->description);
    $notes = Document::fromJson((array) $item->values()->where('property_id', Property::query()->where('key', 'notes')->value('id'))->value('value_json'));
    [$imageCopy] = $description->attachmentIds();
    [$fileCopy] = $notes->attachmentIds();
    $copies = Attachment::query()->whereKey([$imageCopy, $fileCopy])->get()->keyBy('id');

    expect($item->template_id)->toBe($template->id)
        // what is no picture of the template stays as it is
        ->and($description->mentionedUserIds())->toBe([$mara->id])
        ->and([$imageCopy, $fileCopy])->not->toContain($image->id)->not->toContain($file->id)
        ->and($copies)->toHaveCount(2)
        ->and($copies->map(fn (Attachment $a) => [$a->attachable_type, $a->attachable_id, $a->uploaded_by, $a->project_id])->unique()->values()->all())
        ->toBe([['work_item', $item->id, $mara->id, $web->id]])
        ->and([$copies[$imageCopy]->kind, $copies[$imageCopy]->filename, $copies[$imageCopy]->mime, $copies[$imageCopy]->size])
        ->toBe(['inline', 'skizze.png', 'image/png', $image->size])
        ->and([$copies[$fileCopy]->filename, $copies[$fileCopy]->mime])->toBe(['plan.pdf', 'application/pdf'])
        ->and(Storage::disk('local')->get($path($copies[$imageCopy])))->toBe('Inhalt skizze.png')
        ->and(basename($path($copies[$fileCopy])))->toBe("{$fileCopy}.pdf")
        ->and($copies[$imageCopy]->getFirstMedia('file')?->name)->toBe($imageCopy)
        // the template keeps its own
        ->and([$image->fresh()?->attachable_id, $file->fresh()?->attachable_id])->toBe([$template->id, $template->id])
        ->and(Storage::disk('local')->exists($path($image)))->toBeTrue();
});

it('makes one copy of a picture two texts name', function () use ($world, $owned) {
    [, $mara, $template] = $world();
    $image = $owned($template, 'skizze.png', 'image/png');

    $item = CreateWorkItem::run(actor($mara), [
        'project_id' => 'WEB', 'title' => 'Zweimal', 'template_id' => $template->id,
        'description_json' => F::doc(F::image($image->id, 'A'), F::image($image->id, 'B')),
        'values' => ['notes' => F::doc(F::image($image->id, 'C'))],
    ]);

    expect(array_unique(Document::fromJson((array) $item->description)->attachmentIds()))->toHaveCount(1)
        ->and(Attachment::query()->where('attachable_id', $item->id)->count())->toBe(1);
});

it('keeps the copies when the template goes', function () use ($world, $owned, $path) {
    [, $mara, $template] = $world();
    $image = $owned($template, 'skizze.png', 'image/png');
    $item = CreateWorkItem::run(actor($mara), ['project_id' => 'WEB', 'title' => 'Wartung', 'template_id' => $template->id, 'description_json' => F::doc(F::image($image->id, 'Skizze'))]);
    [$copy] = Document::fromJson((array) $item->description)->attachmentIds();

    DeleteTemplate::run(actor($mara), $template);

    $kept = Attachment::query()->findOrFail($copy);
    expect($kept->attachable_id)->toBe($item->id)
        ->and(Storage::disk('local')->exists($path($kept)))->toBeTrue()
        ->and(Attachment::query()->find($image->id))->toBeNull()
        ->and($item->fresh()?->template_id)->toBeNull();
});

it('leaves an image the template does not own as it is', function () use ($world, $owned) {
    [$web, $mara, $template] = $world();
    $other = WorkItem::factory()->for($web)->create();
    $shared = $owned($other, 'geteilt.png', 'image/png');

    $item = CreateWorkItem::run(actor($mara), ['project_id' => 'WEB', 'title' => 'Geteilt', 'template_id' => $template->id, 'description_json' => F::doc(F::image($shared->id, 'Geteilt'))]);

    expect(Document::fromJson((array) $item->description)->attachmentIds())->toBe([$shared->id])
        ->and($shared->fresh()?->attachable_id)->toBe($other->id)
        ->and(Attachment::query()->count())->toBe(1);
});

it('refuses a template of another project', function () use ($world) {
    [, $mara] = $world();
    $ops = Project::factory()->identifier('OPS')->public()->member($mara, ProjectRole::Admin)->create();
    $foreign = Template::factory()->create(['project_id' => $ops->id]);
    $errors = fn (mixed $id) => rescue(fn () => CreateWorkItem::run(actor($mara), ['project_id' => 'WEB', 'title' => '', 'template_id' => $id]), fn (ValidationException $e) => $e->errors(), false);

    expect($errors($foreign->id))->toEqual(['title' => [__('field.title.required')], 'template_id' => [__('field.template_id.unknown')]])
        ->and($errors('keine'))->toHaveKey('template_id')
        ->and($errors(['x']))->toHaveKey('template_id')
        ->and(WorkItem::query()->count())->toBe(0);
});

it('refuses a template deleted before the lock and leaves its copies without owner', function () use ($world, $owned) {
    [$web, $mara, $template] = $world();
    $image = $owned($template, 'skizze.png', 'image/png');
    $prepared = CreateWorkItem::prepare(actor($mara), ['project_id' => 'WEB', 'title' => 'Zu spät', 'template_id' => $template->id, 'description_json' => F::doc(F::image($image->id, 'Skizze'))]);
    DB::table('templates')->where('id', $template->id)->delete();

    $errors = rescue(fn () => CreateWorkItem::insert(actor($mara), $web, $prepared), fn (ValidationException $e) => $e->errors(), false);

    expect($errors)->toBe(['template_id' => [__('field.template_id.unknown')]])
        ->and(WorkItem::query()->count())->toBe(0)
        ->and(Attachment::query()->whereNull('attachable_id')->where('uploaded_by', $mara->id)->count())->toBe(1);
});

it('notes the template in the history', function () use ($world) {
    [$web, $mara, $template] = $world();
    $this->actingAs($mara);

    $made = $this->postJson('/api/v1/work-items', ['project_id' => 'WEB', 'title' => 'Aus Vorlage', 'template_id' => $template->id, 'description' => 'Ohne Bild'])
        ->assertCreated()->assertJsonPath('data.template_id', $template->id)->assertJsonPath('data.description', 'Ohne Bild')->json('data.id');
    $plain = CreateWorkItem::run(actor($mara), ['project_id' => $web->id, 'title' => 'Ohne Vorlage']);
    $template->update(['name' => 'Umbenannt']);

    expect(eventsOf(EventType::WorkItemCreated, WorkItem::query()->findOrFail($made))->sole()->meta)->toMatchArray(['template' => ['id' => $template->id, 'name' => 'Wartung']])
        ->and(eventsOf(EventType::WorkItemCreated, $plain)->sole()->meta)->not->toHaveKey('template');
    $this->getJson("/api/v1/work-items/{$made}/history")->assertOk()->assertJsonPath('data.0.template', ['id' => $template->id, 'name' => 'Wartung']);
    $this->getJson("/api/v1/work-items/{$plain->id}/history")->assertOk()->assertJsonPath('data.0.template', null)->assertJsonPath('data.0.via', 'ui');
});

it('a refused item leaves its copies without owner for the hourly prune', function () use ($world, $owned, $path) {
    [, $mara, $template] = $world();
    $image = $owned($template, 'skizze.png', 'image/png');

    $refused = rescue(fn () => CreateWorkItem::run(actor($mara), ['project_id' => 'WEB', 'title' => '', 'template_id' => $template->id, 'description_json' => F::doc(F::image($image->id, 'Skizze'))]), fn (ValidationException $e) => $e->errors(), false);
    $copy = Attachment::query()->whereNull('attachable_id')->sole();
    $stored = $path($copy);
    $this->travel(2)->days();
    $pruned = PruneUnownedAttachments::run(Actor::automation('test'), now()->subDay());

    expect($refused)->toHaveKey('title')
        ->and($copy->uploaded_by)->toBe($mara->id)
        ->and($pruned)->toBe(1)
        ->and(Storage::disk('local')->exists($stored))->toBeFalse()
        ->and($image->fresh()?->attachable_id)->toBe($template->id);
});

it('drops a picture of the template whose file or row vanished (K13)', function () use ($world, $owned, $path) {
    [$web, $mara, $template] = $world();
    $lost = $owned($template, 'weg.png', 'image/png');
    $kept = $owned($template, 'da.png', 'image/png');
    Storage::disk('local')->delete($path($lost));
    $texts = ['description_json' => Document::fromJson(F::doc(F::p(F::text('Bilder')), F::image($lost->id, 'Weg'), F::image($kept->id, 'Da'), F::image(F::IMAGE, 'Nie da')))];

    $copied = TemplateAttachments::copy($template, $texts, $mara);

    $ids = $copied['description_json']?->attachmentIds();
    expect($ids)->toHaveCount(1)
        ->and($ids)->not->toContain($kept->id)
        ->and(Attachment::query()->findOrFail($ids[0])->filename)->toBe('da.png')
        ->and(Attachment::query()->where('project_id', $web->id)->count())->toBe(3);
});

it('copies nothing into a project being deleted', function () use ($world, $owned) {
    [$web, $mara, $template] = $world();
    $image = $owned($template, 'skizze.png', 'image/png');
    $web->update(['deleting_at' => now()]);
    $text = Document::fromJson(F::doc(F::image($image->id, 'Skizze')));

    $copied = TemplateAttachments::copy($template, ['description' => $text, 'values.notes' => null], $mara);

    expect($copied['description']?->attachmentIds())->toBe([$image->id])
        ->and($copied['values.notes'])->toBeNull()
        ->and(Attachment::query()->count())->toBe(1);
});

it('creates the item without a text whose only picture of the template vanished', function () use ($world, $owned, $path) {
    [, $mara, $template] = $world();
    $lost = $owned($template, 'weg.png', 'image/png');
    Storage::disk('local')->delete($path($lost));

    $item = CreateWorkItem::run(actor($mara), [
        'project_id' => 'WEB', 'title' => 'Ohne Bild', 'template_id' => $template->id,
        'description_json' => F::doc(F::image($lost->id, 'Weg')),
        'values' => ['notes' => F::doc(F::image($lost->id, 'Weg'))],
    ]);

    expect([$item->description, $item->description_text])->toBe([null, null])
        ->and($item->values()->count())->toBe(0)
        ->and(Attachment::query()->count())->toBe(1);
});
