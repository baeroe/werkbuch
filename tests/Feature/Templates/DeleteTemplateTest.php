<?php

use App\Access\ProjectRole;
use App\Actions\Templates\DeleteTemplate;
use App\Actions\WorkItems\DeleteWorkItem;
use App\Events\EventType;
use App\Models\Attachment;
use App\Models\Event;
use App\Models\Project;
use App\Models\Template;
use App\Models\TemplateRun;
use App\Models\User;
use App\Models\WorkItem;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Spatie\MediaLibrary\MediaCollections\Models\Media;
use Tests\Support\RichTextFixtures as F;

// Deleting a template (spec 4.12): its runs go with it, the items it made stay and forget it. Its pictures go too, after
// the commit, unless another text of the project still shows one: then that text takes it over (A233, A261).

beforeEach(function () {
    Storage::fake('local');
});

/** WEB (public) with Mara as an admin and Lene as a viewer, and a template with a run that made an item. */
$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara']);
    $web = Project::factory()->identifier('WEB')->public()->member($mara, ProjectRole::Admin)->create();
    $lene = memberOf($web, ProjectRole::Viewer);
    $template = Template::factory()->create(['project_id' => $web->id, 'name' => 'Wartung']);
    $item = WorkItem::factory()->for($web)->create(['template_id' => $template->id]);
    TemplateRun::factory()->create(['template_id' => $template->id, 'work_item_id' => $item->id]);

    return [$web, $mara, $lene, $template, $item];
};

it('deletes the template with its runs and keeps the items it made', function () use ($world) {
    [$web, $mara, , $template, $item] = $world();

    DeleteTemplate::run(actor($mara), $template);
    $event = eventsOf(EventType::TemplateDeleted, $template)->sole();

    expect(Template::query()->find($template->id))->toBeNull()
        ->and(TemplateRun::query()->count())->toBe(0)
        ->and($item->fresh()?->template_id)->toBeNull()
        ->and($event->changes)->toBeNull()
        ->and($event->meta)->toMatchArray(['name' => 'Wartung'])
        ->and($event->project_id)->toBe($web->id);
});

it('refuses viewers with 403 and someone without access with 404', function () use ($world) {
    [, , $lene, $template] = $world();
    $ops = Project::factory()->identifier('OPS')->private()->create();
    $hidden = Template::factory()->create(['project_id' => $ops->id]);

    $denied = problemOf(fn () => DeleteTemplate::run(actor($lene), $template));

    expect([$denied->status, $denied->detail])->toBe([403, __('problem.detail.templates_members_only')])
        ->and(problemOf(fn () => DeleteTemplate::run(actor($lene), $hidden))->status)->toBe(404)
        ->and(Template::query()->count())->toBe(2);
});

it('refuses an archived project with 409 and a template deleted meanwhile with 404', function () use ($world) {
    [$web, $mara, , $template] = $world();
    $other = Template::factory()->create(['project_id' => $web->id]);
    DB::table('templates')->where('id', $other->id)->delete();

    $gone = problemOf(fn () => DeleteTemplate::run(actor($mara), $other));
    $web->update(['archived_at' => now()]);
    $archived = problemOf(fn () => DeleteTemplate::run(actor($mara), $template));

    expect($gone->status)->toBe(404)
        ->and([$archived->status, $archived->reason])->toBe([409, 'project_archived'])
        ->and(Template::query()->count())->toBe(1)
        ->and(eventsOf(EventType::TemplateDeleted))->toHaveCount(0);
});

/** A stored picture the template owns. */
$pictureOf = fn (Template $template, string $name) => Attachment::factory()->forTemplate($template)->stored('Inhalt', 'image/png', $name)
    ->create(['uploaded_by' => $template->created_by]);

$path = fn (Attachment $attachment) => (string) $attachment->getFirstMedia('file')?->getPathRelativeToRoot();

$owner = fn (Attachment $attachment) => Attachment::query()->whereKey($attachment->id)->first(['attachable_type', 'attachable_id', 'kind'])
    ?->only(['attachable_type', 'attachable_id', 'kind']);

it('hands an image a description still shows over to that item and removes the rest after the commit', function () use ($world, $pictureOf, $path, $owner) {
    [$web, $mara, , $template] = $world();
    $shown = $pictureOf($template, 'beschrieben.png');
    $copied = $pictureOf($template, 'kopiert.png');
    $gone = $pictureOf($template, 'weg.png');
    $value = $pictureOf($template, 'wert.png');
    // the template's own texts name all four: they go with it and keep nothing
    $template->update(['payload' => [
        ...$template->payload,
        'description' => F::doc(F::image($shown->id, null), F::image($copied->id, null), F::image($gone->id, null)),
        'values' => ['notes' => F::doc(F::image($value->id, null))],
    ]]);
    $item = WorkItem::factory()->for($web)->create(['description' => F::doc(F::p('Siehe'), F::image($shown->id, 'Plan'))]);
    $other = Template::factory()->create(['project_id' => $web->id, 'name' => 'Andere']);
    $other->update(['payload' => [...$other->payload, 'values' => ['notes' => F::doc(F::image($copied->id, null))]]]);
    // the same pictures in texts of another project name nothing here
    WorkItem::factory()->create(['description' => F::doc(F::image($gone->id, null))]);
    $elsewhere = Template::factory()->create();
    $elsewhere->update(['payload' => [...$elsewhere->payload, 'description' => F::doc(F::image($value->id, null))]]);
    $files = array_map($path, [$shown, $copied, $gone, $value]);
    $during = null;
    Event::created(function (Event $event) use (&$during, $files) {
        if ($event->type === EventType::TemplateDeleted) {
            $during = array_map(fn (string $file) => Storage::disk('local')->exists($file), $files);
        }
    });

    DeleteTemplate::run(actor($mara), $template);

    expect($during)->toBe([true, true, true, true])
        ->and($owner($shown))->toBe(['attachable_type' => 'work_item', 'attachable_id' => $item->id, 'kind' => 'inline'])
        ->and($owner($copied))->toBe(['attachable_type' => 'template', 'attachable_id' => $other->id, 'kind' => 'inline'])
        ->and($owner($gone))->toBeNull()
        ->and($owner($value))->toBeNull()
        ->and(array_map(fn (string $file) => Storage::disk('local')->exists($file), $files))->toBe([true, true, false, false])
        ->and(Media::query()->count())->toBe(2);
});

it('takes over the picture of a deleted item a template shows', function () use ($world, $owner) {
    [$web, $mara, , $template] = $world();
    $item = WorkItem::factory()->for($web)->create();
    $picture = Attachment::factory()->forItem($item)->stored('Inhalt', 'image/png', 'plan.png')->create(['uploaded_by' => $mara->id]);
    $item->update(['description' => F::doc(F::image($picture->id, null))]);
    $template->update(['payload' => [...$template->payload, 'description' => F::doc(F::p('Wartung'), F::image($picture->id, null))]]);

    DeleteWorkItem::run(actor($mara), $item);

    expect($owner($picture))->toBe(['attachable_type' => 'template', 'attachable_id' => $template->id, 'kind' => 'inline']);
    $this->actingAs($mara)->get("/attachments/{$picture->id}")->assertOk();
});
