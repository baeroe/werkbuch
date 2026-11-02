<?php

use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Actions\Attachments\UploadAttachment;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Attachment;
use App\Models\Event;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Spatie\MediaLibrary\MediaCollections\Models\Media;

beforeEach(function () {
    Storage::fake('local');
});

$png = fn (string $name = 'skizze.png') => UploadedFile::fake()->createWithContent($name, (string) base64_decode(explode(',', imageDataUrl())[1]));

$upload = fn (User $user, array $input, ?UploadedFile $file) => test()->actingAs($user)->post('/api/v1/attachments', [...$input, ...($file === null ? [] : ['file' => $file])], ['Accept' => 'application/json']);

it('stores an image for a text without owner and records nothing', function () use ($png, $upload) {
    $project = Project::factory()->identifier('WEB')->create();
    $mara = memberOf($project, ProjectRole::Member);
    $events = Event::query()->count();

    $response = $upload($mara, ['project_id' => 'WEB', 'kind' => 'inline'], $png())->assertCreated();

    $attachment = Attachment::query()->sole();
    $media = Media::query()->sole();
    expect($response->json('data'))->toBe([
        'id' => $attachment->id,
        'project_id' => $project->id,
        'owner' => null,
        'kind' => 'inline',
        'filename' => 'skizze.png',
        'mime' => 'image/png',
        'size' => $attachment->size,
        'inline' => true,
        'url' => "/attachments/{$attachment->id}",
        'preview_url' => null,
        'uploaded_by' => $mara->id,
        'created_at' => $attachment->created_at?->toJSON(),
    ])->and($attachment->size)->toBeGreaterThan(0)
        ->and($media->model_type)->toBe('attachment')->and($media->model_id)->toBe($attachment->id)
        ->and($media->collection_name)->toBe('file')->and($media->file_name)->toBe("{$attachment->id}.png")
        ->and(Storage::disk('local')->exists($media->getPathRelativeToRoot()))->toBeTrue()
        ->and(Event::query()->count())->toBe($events);
});

it('lets a viewer upload into a text, and an outsider of a public project (A234)', function () use ($png, $upload) {
    $project = Project::factory()->identifier('WEB')->public()->create();

    $upload(memberOf($project, ProjectRole::Viewer), ['project_id' => 'WEB', 'kind' => 'inline'], $png())->assertCreated();
    $upload(User::factory()->create(), ['project_id' => 'WEB', 'kind' => 'inline'], $png())->assertCreated();

    expect(Attachment::query()->count())->toBe(2);
});

it('refuses an outsider of a private project with 404, for a text and for the file list', function () use ($png, $upload) {
    Project::factory()->identifier('OPS')->private()->create();
    $ida = User::factory()->create(['name' => 'Ida']);
    $item = WorkItem::factory()->state(['project_id' => Project::query()->sole()->id])->create();

    $upload($ida, ['project_id' => 'OPS', 'kind' => 'inline'], $png())->assertNotFound()->assertJsonMissingPath('detail');
    $upload($ida, ['project_id' => 'OPS', 'kind' => 'file', 'work_item_id' => $item->key], $png())->assertNotFound();
    $upload($ida, ['project_id' => 'NOPE', 'kind' => 'inline'], $png())->assertNotFound();
    // the project is unknown before the kind is looked at: no 422 tells that OPS exists
    $upload($ida, ['project_id' => 'OPS', 'kind' => 'other'], $png())->assertNotFound();

    expect(Attachment::query()->count())->toBe(0);
});

it('stores a file of the file list with an event and a new updated_at', function () use ($upload) {
    $project = Project::factory()->identifier('WEB')->create();
    $mara = memberOf($project, ProjectRole::Member);
    $item = WorkItem::factory()->state(['project_id' => $project->id])->create();
    Carbon::setTestNow(now()->addMinutes(5)->startOfSecond());

    $response = $upload($mara, ['project_id' => $project->id, 'kind' => 'file', 'work_item_id' => $item->key], UploadedFile::fake()->createWithContent('angebot.pdf', "%PDF-1.4\n%%EOF\n"))
        ->assertCreated()
        ->assertJsonPath('data.owner', ['type' => 'work_item', 'id' => $item->id])
        ->assertJsonPath('data.kind', 'file')
        ->assertJsonPath('data.mime', 'application/pdf')
        ->assertJsonPath('data.inline', false);

    $event = eventsOf(EventType::WorkItemUpdated, $item)->sole();
    expect($event->actor_id)->toBe($mara->id)
        ->and($event->project_id)->toBe($project->id)
        ->and($event->changes)->toBe(['attachments' => ['old' => null, 'new' => ['id' => $response->json('data.id'), 'filename' => 'angebot.pdf']]])
        ->and($item->fresh()?->updated_at?->toJSON())->toBe(now()->toJSON());
});

it('refuses the file list to a viewer with 403 and checks the item', function () use ($png, $upload) {
    $web = Project::factory()->identifier('WEB')->public()->create();
    $ops = Project::factory()->identifier('OPS')->private()->create();
    $item = WorkItem::factory()->state(['project_id' => $web->id])->create();
    $hidden = WorkItem::factory()->state(['project_id' => $ops->id])->create();
    $app = Project::factory()->identifier('APP')->create();
    $other = WorkItem::factory()->state(['project_id' => $app->id])->create();
    $viewer = memberOf($web, ProjectRole::Viewer);
    $mara = memberOf($web, ProjectRole::Member);
    app(RoleAssignments::class)->setProjectRole($mara, $app, ProjectRole::Member);

    $upload($viewer, ['project_id' => 'WEB', 'kind' => 'file', 'work_item_id' => $item->key], $png())
        ->assertForbidden()->assertJsonPath('detail', __('problem.detail.items_members_only'));
    // an item the account does not see is unknown, one of another project it sees a field error
    $upload($mara, ['project_id' => 'WEB', 'kind' => 'file', 'work_item_id' => $hidden->key], $png())->assertNotFound();
    $upload($mara, ['project_id' => 'WEB', 'kind' => 'file', 'work_item_id' => 'WEB-99'], $png())->assertNotFound();
    expect(errorsAt($upload($mara, ['project_id' => 'WEB', 'kind' => 'file', 'work_item_id' => $other->key], $png())->assertUnprocessable(), 'work_item_id'))
        ->toBe([__('field.work_item_id.project')])
        ->and(errorsAt($upload($mara, ['project_id' => 'WEB', 'kind' => 'file'], $png())->assertUnprocessable(), 'work_item_id'))
        ->toBe([__('field.required')])
        ->and(Attachment::query()->count())->toBe(0);
});

it('names the fields of an upload that cannot be read', function () use ($png, $upload) {
    $project = Project::factory()->identifier('WEB')->create();
    $mara = memberOf($project, ProjectRole::Member);

    expect(errorsAt($upload($mara, ['kind' => 'inline'], $png())->assertUnprocessable(), 'project_id'))->toBe([__('field.required')])
        ->and(errorsAt($upload($mara, ['project_id' => 'WEB', 'kind' => 'image'], $png())->assertUnprocessable(), 'kind'))->toBe([__('field.kind.attachment')])
        ->and(errorsAt($upload($mara, ['project_id' => 'WEB'], $png())->assertUnprocessable(), 'kind'))->toBe([__('field.kind.attachment')])
        // no file at all is the client's mistake; a body PHP refused never gets this far (413)
        ->and(errorsAt($upload($mara, ['project_id' => 'WEB', 'kind' => 'inline'], null)->assertUnprocessable(), 'file'))->toBe([__('field.file.required')])
        ->and(errorsAt($upload($mara, ['project_id' => 'WEB', 'kind' => 'inline', 'file' => 'not a file'], null)->assertUnprocessable(), 'file'))->toBe([__('field.file.required')])
        ->and(errorsAt($upload($mara, ['project_id' => 'WEB', 'kind' => 'inline'], new UploadedFile(__FILE__, 'halb.png', null, UPLOAD_ERR_PARTIAL, true))->assertUnprocessable(), 'file'))
        ->toBe([__('field.file.invalid')])
        ->and(Attachment::query()->count())->toBe(0);
});

it('answers 413 above ATTACHMENTS_MAX_MB', function () use ($upload) {
    config(['werkbuch.attachments_max_mb' => 1]);
    $project = Project::factory()->identifier('WEB')->create();
    $mara = memberOf($project, ProjectRole::Member);

    $upload($mara, ['project_id' => 'WEB', 'kind' => 'inline'], UploadedFile::fake()->create('a.bin', 1100))
        ->assertStatus(413)
        ->assertHeader('Content-Type', 'application/problem+json')
        ->assertJsonPath('reason', 'payload_too_large')
        ->assertJsonPath('detail', __('problem.detail.payload_too_large', ['max' => 1]));
    // exactly the limit still fits
    $upload($mara, ['project_id' => 'WEB', 'kind' => 'inline'], UploadedFile::fake()->create('b.bin', 1024))->assertCreated();

    expect(Attachment::query()->sole()->filename)->toBe('b.bin');
});

it('answers 413 when PHP dropped the file', function (int $error) use ($upload) {
    $project = Project::factory()->identifier('WEB')->create();
    $mara = memberOf($project, ProjectRole::Member);

    $upload($mara, ['project_id' => 'WEB', 'kind' => 'inline'], new UploadedFile(__FILE__, 'gross.mov', null, $error, true))
        ->assertStatus(413)
        ->assertJsonPath('reason', 'payload_too_large')
        ->assertJsonPath('detail', __('problem.detail.payload_too_large', ['max' => 25]));

    expect(Attachment::query()->count())->toBe(0);
})->with(['upload_max_filesize' => UPLOAD_ERR_INI_SIZE, 'MAX_FILE_SIZE of the form' => UPLOAD_ERR_FORM_SIZE]);

it('answers 413 for a body above post_max_size', function () {
    // the limit of the PHP that runs the tests (DDEV 100M, CI 32M), never a fixed number
    $limit = ini_parse_quantity((string) ini_get('post_max_size'));
    $user = User::factory()->create();

    $this->actingAs($user)->call('POST', '/api/v1/attachments', [], [], [], ['CONTENT_LENGTH' => (string) ($limit + 1), 'HTTP_ACCEPT' => 'application/json'])
        ->assertStatus(413)
        ->assertHeader('Content-Type', 'application/problem+json')
        ->assertJsonPath('reason', 'payload_too_large')
        ->assertJsonPath('detail', __('problem.detail.payload_too_large', ['max' => 25]));
    // a web route keeps Laravel's own answer
    $web = $this->actingAs($user)->call('POST', '/login', [], [], [], ['CONTENT_LENGTH' => (string) ($limit + 1)])->assertStatus(413);
    expect($web->headers->get('Content-Type'))->not->toBe('application/problem+json');
});

it('reads the type from the content, not from the client', function () use ($upload) {
    $project = Project::factory()->identifier('WEB')->create();
    $mara = memberOf($project, ProjectRole::Member);
    $svg = UploadedFile::fake()->createWithContent('logo.png', '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

    $upload($mara, ['project_id' => 'WEB', 'kind' => 'inline'], $svg)->assertCreated()
        ->assertJsonPath('data.mime', 'image/svg+xml')
        ->assertJsonPath('data.inline', false)
        ->assertJsonPath('data.filename', 'logo.png');
});

it('cleans the file name', function (string $sent, string $kept) {
    $project = Project::factory()->create();
    $mara = memberOf($project, ProjectRole::Member);

    $attachment = UploadAttachment::run(actor($mara), ['project_id' => $project->id, 'kind' => 'inline'], UploadedFile::fake()->createWithContent($sent, 'x'));

    expect($attachment->filename)->toBe($kept);
})->with([
    'a path' => ['C:\\Users\\mara\\bericht.pdf', 'bericht.pdf'],
    'control characters' => ["be\tri\x00cht\x7f.pdf", 'bericht.pdf'],
    'a right-to-left override' => ["\u{202E}fdp.exe", 'fdp.exe'],
    'leading and trailing spaces' => ['  notiz.txt  ', 'notiz.txt'],
    'nothing left' => ["\x01\x02", 'datei'],
    'no UTF-8' => ["caf\xe9.txt", 'caf?.txt'],
    'too long, the extension kept' => [str_repeat('ü', 300).'.pdf', str_repeat('ü', 251).'.pdf'],
    'too long, a long extension cut' => ['a.'.str_repeat('x', 300), 'a.'.str_repeat('x', 253)],
]);

it('stores the file under a plain extension, never one medialibrary refuses', function (string $name, string $stored) {
    $project = Project::factory()->create();
    $mara = memberOf($project, ProjectRole::Member);

    $attachment = UploadAttachment::run(actor($mara), ['project_id' => $project->id, 'kind' => 'inline'], UploadedFile::fake()->createWithContent($name, 'x'));

    expect($attachment->filename)->toBe($name)
        ->and(Media::query()->sole()->file_name)->toBe("{$attachment->id}.{$stored}");
})->with([
    'a script' => ['shell.php', 'bin'],
    'no extension' => ['README', 'bin'],
    'an odd one' => ['notiz.t x t', 'bin'],
    'an upper-case one' => ['FOTO.JPG', 'jpg'],
]);

it('leaves no file behind when the transaction fails, and keeps the upload for a retry', function () {
    $project = Project::factory()->create();
    $mara = memberOf($project, ProjectRole::Member);
    $item = WorkItem::factory()->state(['project_id' => $project->id])->create();
    $file = UploadedFile::fake()->createWithContent('angebot.txt', 'Angebot');
    // the event is the last write of the transaction: the file is on the disk by then
    Event::creating(fn () => throw new RuntimeException('the outbox fails'));

    expect(fn () => UploadAttachment::run(actor($mara), ['project_id' => $project->id, 'kind' => 'file', 'work_item_id' => $item->id], $file))
        ->toThrow(RuntimeException::class, 'the outbox fails');

    expect(Attachment::query()->count())->toBe(0)
        ->and(Media::query()->count())->toBe(0)
        ->and(Storage::disk('local')->allFiles())->toBe([])
        ->and(file_exists((string) $file->getRealPath()))->toBeTrue();
});

it('refuses an archived project and an archived item with 409', function () use ($png, $upload) {
    $archived = Project::factory()->identifier('OLD')->archived()->create();
    $web = Project::factory()->identifier('WEB')->create();
    $admin = User::factory()->admin()->create();
    $oldItem = WorkItem::factory()->state(['project_id' => $archived->id])->create();
    $done = WorkItem::factory()->state(['project_id' => $web->id])->archived()->create();

    $upload($admin, ['project_id' => 'OLD', 'kind' => 'inline'], $png())->assertConflict()->assertJsonPath('reason', 'project_archived');
    $upload($admin, ['project_id' => 'OLD', 'kind' => 'file', 'work_item_id' => $oldItem->key], $png())->assertConflict()->assertJsonPath('reason', 'project_archived');
    $upload($admin, ['project_id' => 'WEB', 'kind' => 'file', 'work_item_id' => $done->key], $png())->assertConflict()
        ->assertJsonPath('reason', 'archived')->assertJsonPath('detail', __('problem.detail.item_archived', ['key' => $done->key]));

    expect(Attachment::query()->count())->toBe(0)->and(Storage::disk('local')->allFiles())->toBe([]);
});

it('refuses a project being deleted', function () use ($png) {
    $project = Project::factory()->create(['deleting_at' => now()]);

    expect(problemOf(fn () => UploadAttachment::run(actor(User::factory()->admin()->create()), ['project_id' => $project->id, 'kind' => 'inline'], $png()))->status)->toBe(404);
});

it('limits uploads to 60 per minute and account', function () use ($upload) {
    $project = Project::factory()->identifier('WEB')->create();
    $mara = memberOf($project, ProjectRole::Member);

    foreach (range(1, 60) as $_) {
        $upload($mara, ['project_id' => 'WEB', 'kind' => 'nothing'], null)->assertUnprocessable();
    }

    $upload($mara, ['project_id' => 'WEB', 'kind' => 'nothing'], null)->assertStatus(429)->assertJsonPath('reason', 'too_many_requests');
    // another account has its own minute
    $upload(memberOf($project, ProjectRole::Member), ['project_id' => 'WEB', 'kind' => 'nothing'], null)->assertUnprocessable();
});

it('has the factory of the 413', function () {
    $problem = Problem::tooLarge('Zu groß.');

    expect($problem->status)->toBe(413)->and($problem->reason)->toBe('payload_too_large')->and($problem->detail)->toBe('Zu groß.')
        ->and(Attachment::tooLarge()->detail)->toBe(__('problem.detail.payload_too_large', ['max' => 25]));
});

it('binds an attachment by its ULID in any case, and nothing else', function () use ($png) {
    $project = Project::factory()->create();
    $mara = memberOf($project, ProjectRole::Member);
    $attachment = UploadAttachment::run(actor($mara), ['project_id' => $project->id, 'kind' => 'inline'], $png());

    $this->actingAs($mara)->getJson('/api/v1/attachments/'.Str::upper($attachment->id))->assertOk()->assertJsonPath('data.id', $attachment->id);
    $this->actingAs($mara)->getJson('/api/v1/attachments/bild.png')->assertNotFound();
    $this->actingAs($mara)->getJson('/api/v1/attachments/'.Str::ulid())->assertNotFound();
});
