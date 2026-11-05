<?php

use App\Access\ProjectRole;
use App\Actions\Attachments\PruneAttachments;
use App\Actions\Attachments\PruneUnownedAttachments;
use App\Actions\WorkItems\DeleteWorkItem;
use App\Domain\Properties\FieldType;
use App\Jobs\PruneUnownedAttachmentsJob;
use App\Models\Attachment;
use App\Models\Comment;
use App\Models\Event;
use App\Models\Page;
use App\Models\PageVersion;
use App\Models\Project;
use App\Models\Property;
use App\Models\Template;
use App\Models\User;
use App\Models\WorkItem;
use App\Models\WorkItemValue;
use App\Support\Actor;
use App\Support\UnreadableText;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Queue\Middleware\WithoutOverlapping;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Exceptions;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Spatie\MediaLibrary\MediaCollections\Models\Media;
use Tests\Support\RichTextFixtures as F;

beforeEach(function () {
    Storage::fake('local');
    Carbon::setTestNow('2026-11-02 10:00:00');
});

/** WEB with Mara as its admin. @return array{Project, User} */
$web = function (): array {
    $mara = User::factory()->create(['name' => 'Mara']);
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);

    return [$web, $mara];
};

/** An attachment of Mara's with its file, uploaded `$age` ago. */
$upload = fn (User $mara, string $name, string $age) => Attachment::factory()->stored('Inhalt', 'text/plain', $name)
    ->state(['uploaded_by' => $mara->id, 'created_at' => now()->sub($age)]);

$path = fn (Attachment $attachment) => (string) $attachment->getFirstMedia('file')?->getPathRelativeToRoot();

$system = fn () => Actor::system(User::defaultBot(), 'prune_attachments');

it('removes unowned uploads older than a day, not younger ones and not owned ones', function () use ($web, $upload, $path, $system) {
    [$project, $mara] = $web();
    $item = WorkItem::factory()->for($project)->create();
    $old = $upload($mara, 'alt.png', '25 hours')->create(['project_id' => $project->id]);
    $young = $upload($mara, 'neu.png', '23 hours')->create(['project_id' => $project->id]);
    $owned = $upload($mara, 'bild.png', '3 days')->forItem($item)->create();
    $file = $path($old);
    $events = Event::query()->count();

    $pruned = PruneUnownedAttachments::run($system(), now()->subDay());

    expect($pruned)->toBe(1)
        ->and(Attachment::query()->orderBy('filename')->pluck('id')->all())->toBe([$owned->id, $young->id])
        ->and(Media::query()->where('model_id', $old->id)->count())->toBe(0)
        ->and(Storage::disk('local')->exists($file))->toBeFalse()
        ->and(Storage::disk('local')->exists($path($young)))->toBeTrue()
        ->and(Storage::disk('local')->exists($path($owned)))->toBeTrue()
        // A239: the clean-up records nothing
        ->and(Event::query()->count())->toBe($events);
});

it('works through more unowned uploads than fit into one block', function () use ($web, $system) {
    [$project, $mara] = $web();
    Attachment::factory()->count(PruneUnownedAttachments::BLOCK + 1)
        ->create(['project_id' => $project->id, 'uploaded_by' => $mara->id, 'created_at' => now()->subDays(2)]);

    expect(PruneUnownedAttachments::run($system(), now()->subDay()))->toBe(PruneUnownedAttachments::BLOCK + 1)
        ->and(Attachment::query()->count())->toBe(0);
});

it('prunes unowned uploads every hour on the default queue, older than 24 hours', function () use ($web, $upload) {
    [$project, $mara] = $web();
    $old = $upload($mara, 'alt.png', '25 hours')->create(['project_id' => $project->id]);
    $young = $upload($mara, 'neu.png', '23 hours')->create(['project_id' => $project->id]);
    $task = collect(app(Schedule::class)->events())->sole(fn ($event) => $event->description === PruneUnownedAttachmentsJob::class);

    (new PruneUnownedAttachmentsJob)->handle();

    expect($task->expression)->toBe('0 * * * *')
        ->and($task->withoutOverlapping)->toBeTrue()
        ->and((new PruneUnownedAttachmentsJob)->queue)->toBeNull()
        ->and(Attachment::query()->pluck('id')->all())->toBe([$young->id])
        ->and(Attachment::query()->find($old->id))->toBeNull();
});

/**
 * WEB, 40 days ago: an item whose description names `named.png` and the comment's `kopiert.png`, a rich text value
 * that names `wert.png`, a comment that names `kommentar.png`; `weg.png` (item) and `entfernt.png` (comment) are named
 * by no text any more, `verwaist.png` belongs to a comment that is gone. `jung.png` is unnamed but only ten days old.
 *
 * @return array<string, Attachment>
 */
$texts = function () use ($web, $upload): array {
    [$project, $mara] = $web();
    $item = WorkItem::factory()->for($project)->create();
    $comment = Comment::factory()->create(['work_item_id' => $item->id, 'author_id' => $mara->id]);
    $ofComment = fn (Comment $comment) => ['project_id' => $project->id, 'attachable_type' => $comment->getMorphClass(), 'attachable_id' => $comment->id];
    $a = [
        'named' => $upload($mara, 'named.png', '40 days')->forItem($item)->create(),
        'weg' => $upload($mara, 'weg.png', '40 days')->forItem($item)->create(),
        'wert' => $upload($mara, 'wert.png', '40 days')->forItem($item)->create(),
        'kommentar' => $upload($mara, 'kommentar.png', '40 days')->create($ofComment($comment)),
        'entfernt' => $upload($mara, 'entfernt.png', '40 days')->create($ofComment($comment)),
        'kopiert' => $upload($mara, 'kopiert.png', '40 days')->create($ofComment($comment)),
        'verwaist' => $upload($mara, 'verwaist.png', '40 days')->create([
            'project_id' => $project->id, 'attachable_type' => 'comment', 'attachable_id' => strtolower((string) Str::ulid()),
        ]),
        'jung' => $upload($mara, 'jung.png', '10 days')->forItem($item)->create(),
    ];

    $item->update(['description' => F::doc(F::p('Plan'), F::image($a['named']->id, 'Plan'), F::p(F::file($a['kopiert']->id, 'kopiert.png')))]);
    $comment->update(['body' => F::doc(F::image($a['kommentar']->id, null))]);
    $notes = Property::factory()->create(['key' => 'notes', 'label' => 'Notizen', 'field_type' => FieldType::RichText]);
    WorkItemValue::query()->create([
        'work_item_id' => $item->id, 'property_id' => $notes->id, 'position' => 0, 'value_json' => F::doc(F::image($a['wert']->id, null)),
    ]);
    // another item of the project without any text
    WorkItem::factory()->for($project)->create();

    return $a;
};

it('prunes images no text names any more and keeps those still named', function () use ($texts, $path, $system) {
    $a = $texts();
    $paths = array_map($path, $a);
    $events = Event::query()->count();

    $pruned = PruneAttachments::run($system(), 30, false);

    $gone = ['weg', 'entfernt', 'verwaist'];
    expect(collect($pruned)->sortBy('filename')->values()->all())->toBe(collect($gone)->map(fn (string $key) => [
        'id' => $a[$key]->id, 'project' => 'WEB', 'filename' => "{$key}.png", 'size' => strlen('Inhalt'),
    ])->sortBy('filename')->values()->all())
        ->and(Attachment::query()->orderBy('filename')->pluck('filename')->all())->toBe(['jung.png', 'kommentar.png', 'kopiert.png', 'named.png', 'wert.png'])
        ->and(Media::query()->count())->toBe(5)
        ->and(collect($paths)->map(fn (string $file) => Storage::disk('local')->exists($file))->filter()->keys()->sort()->values()->all())
        ->toBe(['jung', 'kommentar', 'kopiert', 'named', 'wert'])
        ->and(Event::query()->count())->toBe($events);
});

it('keeps everything in a dry run', function () use ($texts, $path, $system) {
    $a = $texts();

    $pruned = PruneAttachments::run($system(), 30, true);

    expect(collect($pruned)->pluck('filename')->sort()->values()->all())->toBe(['entfernt.png', 'verwaist.png', 'weg.png'])
        ->and(Attachment::query()->count())->toBe(8)
        ->and(Media::query()->count())->toBe(8)
        ->and(collect($a)->every(fn (Attachment $attachment) => Storage::disk('local')->exists($path($attachment))))->toBeTrue();
});

it('counts the minimum age in days', function () use ($texts, $system) {
    $texts();

    expect(collect(PruneAttachments::run($system(), 9, true))->pluck('filename')->sort()->values()->all())
        ->toBe(['entfernt.png', 'jung.png', 'verwaist.png', 'weg.png'])
        ->and(PruneAttachments::run($system(), 41, true))->toBe([])
        ->and(fn () => PruneAttachments::run($system(), 0, true))->toThrow(InvalidArgumentException::class);
});

it('keeps files of the file list', function () use ($web, $upload, $system) {
    [$project, $mara] = $web();
    $item = WorkItem::factory()->for($project)->create();
    $file = $upload($mara, 'angebot.txt', '40 days')->forItem($item, 'file')->create();
    // an upload nobody owns is the hourly job's, not this one's
    $unowned = $upload($mara, 'entwurf.png', '40 days')->create(['project_id' => $project->id]);

    expect(PruneAttachments::run($system(), 30, false))->toBe([])
        ->and(Attachment::query()->orderBy('filename')->pluck('id')->all())->toBe([$file->id, $unowned->id]);
});

it('removes folders of files whose media row is gone, older than the minimum age', function () use ($web, $upload, $path) {
    [$project, $mara] = $web();
    $kept = $upload($mara, 'bild.png', '40 days')->create(['project_id' => $project->id]);
    $disk = Storage::disk('local');
    $put = function (string $file, string $age) use ($disk): void {
        $disk->put($file, 'Vorschau');
        touch($disk->path($file), now()->sub($age)->getTimestamp());
    };
    // a preview a conversion job wrote after its attachment was deleted (T7-M4), and one being written right now
    $put('900001/conversions/alt-preview.png', '31 days');
    $put('900001/alt.png', '40 days');
    $put('900002/conversions/neu-preview.png', '31 days');
    $put('900002/neu.png', '1 day');
    $put('notizen/liste.txt', '40 days');
    touch($disk->path($path($kept)), now()->subDays(40)->getTimestamp());

    $dry = PruneAttachments::make()->folders(30, true);

    expect($dry)->toBe([['folder' => '900001', 'size' => 16]])
        ->and($disk->exists('900001/alt.png'))->toBeTrue()
        ->and(PruneAttachments::make()->folders(30, false))->toBe($dry)
        ->and($disk->exists('900001/alt.png'))->toBeFalse()
        ->and($disk->directories())->not->toContain('900001')
        ->and($disk->exists('900002/neu.png'))->toBeTrue()
        ->and($disk->exists('notizen/liste.txt'))->toBeTrue()
        ->and($disk->exists($path($kept)))->toBeTrue()
        ->and(fn () => PruneAttachments::make()->folders(0, true))->toThrow(InvalidArgumentException::class);
});

it('finds unowned uploads over the morph index and keeps the job from running twice at once (T13-M4, T13-M7)', function () use ($web, $upload, $system) {
    [$project, $mara] = $web();
    $upload($mara, 'alt.png', '25 hours')->create(['project_id' => $project->id]);
    $queries = [];
    DB::listen(function ($query) use (&$queries): void {
        $queries[] = $query->sql;
    });

    PruneUnownedAttachments::run($system(), now()->subDay());

    expect(collect($queries)->first(fn (string $sql) => str_starts_with($sql, 'select') && str_contains($sql, 'from `attachments`')))
        ->toContain('`attachable_type` is null and `attachable_id` is null')
        ->and(collect((new PruneUnownedAttachmentsJob)->middleware())->sole())->toBeInstanceOf(WithoutOverlapping::class);
});

it('leaves pictures of owners whose texts it does not read alone (T13-M2)', function () use ($web, $upload, $system) {
    [$project, $mara] = $web();
    // an owner whose texts are not read here: nothing of it goes
    $foreign = $upload($mara, 'seite.png', '40 days')->create(['project_id' => $project->id, 'attachable_type' => 'project', 'attachable_id' => $project->id]);

    expect(PruneAttachments::run($system(), 30, false))->toBe([])
        ->and($foreign->fresh())->not->toBeNull();
});

/**
 * WEB, 40 days ago: the wiki pages Start and Team. Start owns `seite.png` (its text shows it), `alt.png` (only a kept
 * version of Start shows it), `kopie.png` (only Team's text shows it, copied, A233) and `weg.png` (no text or version
 * shows it any more).
 *
 * @return array<string, Attachment>
 */
$pages = function () use ($web, $upload): array {
    [$project, $mara] = $web();
    $start = Page::factory()->create(['project_id' => $project->id, 'title' => 'Start', 'created_by' => $mara->id]);
    $team = Page::factory()->create(['project_id' => $project->id, 'title' => 'Team', 'created_by' => $mara->id]);
    $a = array_map(fn (string $name) => $upload($mara, "{$name}.png", '40 days')->forPage($start)->create(), [
        'seite' => 'seite', 'alt' => 'alt', 'kopie' => 'kopie', 'weg' => 'weg',
    ]);
    $start->update(['content' => F::doc(F::p('Start'), F::image($a['seite']->id, null))]);
    PageVersion::factory()->create(['page_id' => $start->id, 'version' => 1, 'content' => F::doc(F::p('Alt'), F::image($a['alt']->id, null))]);
    $start->update(['version' => 2]);
    $team->update(['content' => F::doc(F::image($a['kopie']->id, null))]);

    return $a;
};

it('prunes a picture a page no longer shows', function () use ($pages, $system) {
    $a = $pages();

    expect(collect(PruneAttachments::run($system(), 30, false))->pluck('id')->all())->toBe([$a['weg']->id])
        ->and($a['weg']->fresh())->toBeNull();
});

it('keeps a picture a version of the page still shows (A314)', function () use ($pages, $system) {
    $a = $pages();

    PruneAttachments::run($system(), 30, false);

    expect($a['alt']->fresh())->not->toBeNull()
        ->and($a['seite']->fresh())->not->toBeNull();
});

it('keeps a picture another page shows', function () use ($pages, $system) {
    $a = $pages();

    PruneAttachments::run($system(), 30, false);

    expect($a['kopie']->fresh()?->attachable_type)->toBe('page')
        ->and(Attachment::query()->orderBy('filename')->pluck('filename')->all())->toBe(['alt.png', 'kopie.png', 'seite.png']);
});

/**
 * WEB, 40 days ago: the template Wartung owns `vorlage.png` (its description shows it), `wert.png` (a rich text value
 * shows it) and `weg.png` (none of its texts shows it any more); an item owns `kopie.png`, which only the template shows.
 *
 * @return array<string, Attachment>
 */
$templates = function () use ($web, $upload): array {
    [$project, $mara] = $web();
    $template = Template::factory()->create(['project_id' => $project->id, 'name' => 'Wartung', 'created_by' => $mara->id]);
    $item = WorkItem::factory()->for($project)->create();
    $a = [
        ...array_map(fn (string $name) => $upload($mara, "{$name}.png", '40 days')->forTemplate($template)->create(), [
            'vorlage' => 'vorlage', 'wert' => 'wert', 'weg' => 'weg',
        ]),
        'kopie' => $upload($mara, 'kopie.png', '40 days')->forItem($item)->create(),
    ];
    $template->update(['payload' => [
        ...$template->payload,
        'description' => F::doc(F::p('Wartung'), F::image($a['vorlage']->id, null), F::image($a['kopie']->id, null)),
        'values' => ['notes' => F::doc(F::image($a['wert']->id, null))],
    ]]);

    return $a;
};

it('keeps an image only a template shows', function () use ($templates, $system) {
    $a = $templates();

    PruneAttachments::run($system(), 30, false);

    expect(Attachment::query()->orderBy('filename')->pluck('filename')->all())->toBe(['kopie.png', 'vorlage.png', 'wert.png'])
        ->and($a['kopie']->fresh()?->attachable_type)->toBe('work_item');
});

it('prunes an image of a template that no text shows any more', function () use ($templates, $system) {
    $a = $templates();

    expect(collect(PruneAttachments::run($system(), 30, true))->pluck('id')->all())->toBe([$a['weg']->id])
        ->and(collect(PruneAttachments::run($system(), 30, false))->pluck('id')->all())->toBe([$a['weg']->id])
        ->and($a['weg']->fresh())->toBeNull();
});

/** Makes the description of the item one that Document::fromJson refuses (a node it does not know), naming `$id`. */
$unreadable = fn (WorkItem $item, string $id = '') => DB::table('work_items')->where('id', $item->id)
    ->update(['description' => json_encode(['type' => 'doc', 'content' => [['type' => 'wolke', 'attrs' => ['attachmentId' => $id]]]])]);

it('skips a project with an unreadable text, reports it and goes on with the next (T13-M3)', function () use ($upload, $system, $unreadable) {
    Exceptions::fake();
    $mara = User::factory()->create();
    $ops = Project::factory()->identifier('OPS')->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $broken = WorkItem::factory()->for($ops)->create();
    $unreadable($broken);
    $kept = $upload($mara, 'ops.png', '40 days')->forItem($broken)->create();
    $gone = $upload($mara, 'web.png', '40 days')->forItem(WorkItem::factory()->for($web)->create())->create();
    $skipped = [];

    $pruned = PruneAttachments::run($system(), 30, false, function (string $project, UnreadableText $error) use (&$skipped): void {
        $skipped[] = [$project, $error->ownerId];
    });

    expect(collect($pruned)->pluck('id')->all())->toBe([$gone->id])
        ->and($kept->fresh())->not->toBeNull()
        ->and($skipped)->toBe([['OPS', $broken->id]]);
    Exceptions::assertReported(fn (UnreadableText $error) => $error->ownerId === $broken->id);
});

it('deletes an item although another text of the project cannot be read, and reports that text (M1)', function () use ($web, $upload, $unreadable) {
    Exceptions::fake();
    [$project, $mara] = $web();
    $item = WorkItem::factory()->for($project)->create();
    $broken = WorkItem::factory()->for($project)->create();
    $picture = $upload($mara, 'bild.png', '1 day')->forItem($item)->create();
    $unreadable($broken, $picture->id);

    DeleteWorkItem::run(actor($mara), $item);

    expect(WorkItem::query()->find($item->id))->toBeNull()
        ->and($picture->fresh())->toBeNull();
    Exceptions::assertReported(fn (UnreadableText $error) => $error->ownerId === $broken->id && $error->ownerType === 'work_item');
});
