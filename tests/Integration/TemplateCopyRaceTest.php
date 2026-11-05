<?php

use App\Access\ProjectRole;
use App\Actions\Templates\DeleteTemplate;
use App\Models\Attachment;
use App\Models\Project;
use App\Models\Template;
use App\Models\User;
use App\Models\WorkItem;
use App\RichText\Document;
use App\Support\TemplateAttachments;
use Illuminate\Support\Facades\Storage;
use Tests\Support\RaceConnections;
use Tests\Support\RichTextFixtures as F;

/*
 * Copying the pictures of a template while the template is deleted (T6-I1, K13): the copy reads its source before the
 * project lock, DeleteTemplate holds the project `for update` and removes the source with its file after its commit.
 * The copy waits for the project, then reads the source again under it and finds it gone: the node falls out of the
 * text, no copy of a file that is no longer there (a 500 over REST, a job retrying until it fails in a run).
 * `mariadb` holds the deletion open, `mariadb_second` is the copy.
 */

beforeEach(function () {
    RaceConnections::setUp();
    Storage::fake('local');
});

afterEach(fn () => RaceConnections::tearDown());

it('drops a picture whose template was deleted while the copy waited for the project', function () {
    $mara = User::factory()->create();
    $web = Project::factory()->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $template = Template::factory()->create(['project_id' => $web->id, 'created_by' => $mara->id]);
    $image = Attachment::factory()->forTemplate($template)->stored('Inhalt', 'image/png', 'skizze.png')->create(['uploaded_by' => $mara->id]);
    $text = Document::fromJson(F::doc(F::p(F::text('Bild')), F::image($image->id, 'Skizze')));

    RaceConnections::hold(fn () => DeleteTemplate::run(actor($mara), $template));
    RaceConnections::releaseBeforeLock('projects', 'lock in share mode');
    $outcome = RaceConnections::second(fn () => TemplateAttachments::copy(Template::query()->findOrFail($template->id), ['description_json' => $text], $mara));

    expect($outcome)->toBeArray()
        ->and(is_array($outcome) ? $outcome['description_json']?->attachmentIds() : null)->toBe([])
        ->and(Attachment::query()->count())->toBe(0);
});

it('leaves a picture named as it is that another text took over while the copy waited', function () {
    $mara = User::factory()->create();
    $web = Project::factory()->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $template = Template::factory()->create(['project_id' => $web->id, 'created_by' => $mara->id]);
    $image = Attachment::factory()->forTemplate($template)->stored('Inhalt', 'image/png', 'skizze.png')->create(['uploaded_by' => $mara->id]);
    $item = WorkItem::factory()->for($web)->create(['created_by' => $mara->id, 'description' => F::doc(F::image($image->id, 'Skizze'))]);
    $text = Document::fromJson(F::doc(F::image($image->id, 'Skizze')));

    RaceConnections::hold(fn () => DeleteTemplate::run(actor($mara), $template));
    RaceConnections::releaseBeforeLock('projects', 'lock in share mode');
    $outcome = RaceConnections::second(fn () => TemplateAttachments::copy(Template::query()->findOrFail($template->id), ['description_json' => $text], $mara));

    expect(is_array($outcome) ? $outcome['description_json']?->attachmentIds() : null)->toBe([$image->id])
        ->and($image->fresh()?->attachable_id)->toBe($item->id)
        ->and(Attachment::query()->count())->toBe(1);
});
