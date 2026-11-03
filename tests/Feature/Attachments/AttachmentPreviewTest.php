<?php

use App\Access\ProjectRole;
use App\Actions\Attachments\UploadAttachment;
use App\Models\Attachment;
use App\Models\Project;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Spatie\MediaLibrary\Conversions\Jobs\PerformConversionsJob;

beforeEach(function () {
    Storage::fake('local');
    // the test environment runs the queue synchronously (phpunit.xml): a preview is made right after the commit
    config(['media-library.queue_connection_name' => 'sync']);
});

/**
 * A real picture made with GD: the left half transparent, the right half blue, in the format asked for.
 */
$picture = function (string $format, int $width, int $height): string {
    $image = imagecreatetruecolor($width, $height);
    imagealphablending($image, false);
    imagesavealpha($image, true);
    imagefill($image, 0, 0, (int) imagecolorallocatealpha($image, 0, 0, 0, 127));
    imagefilledrectangle($image, intdiv($width, 2), 0, $width - 1, $height - 1, (int) imagecolorallocate($image, 30, 60, 200));

    ob_start();
    match ($format) {
        'png' => imagepng($image),
        'jpeg' => imagejpeg($image),
        'webp' => imagewebp($image),
        'gif' => imagegif($image),
        'avif' => imageavif($image),
    };

    return (string) ob_get_clean();
};

$upload = fn (User $user, Project $project, string $name, string $content) => UploadAttachment::run(
    actor($user),
    ['project_id' => $project->id, 'kind' => 'inline'],
    UploadedFile::fake()->createWithContent($name, $content),
);

it('makes a preview of a large PNG on the queue media', function () use ($picture, $upload) {
    $project = Project::factory()->create();
    $mara = memberOf($project, ProjectRole::Member);
    Queue::fake();

    $attachment = $upload($mara, $project, 'plan.png', $picture('png', 2400, 1200));

    Queue::assertPushedOn('media', PerformConversionsJob::class);
    $this->actingAs($mara)->getJson("/api/v1/attachments/{$attachment->id}")->assertJsonPath('data.preview_url', null);

    app()->call([Queue::pushed(PerformConversionsJob::class)->sole(), 'handle']);

    $this->actingAs($mara)->getJson("/api/v1/attachments/{$attachment->id}")->assertOk()
        ->assertJsonPath('data.preview_url', "/attachments/{$attachment->id}/preview");
    $response = $this->actingAs($mara)->get("/attachments/{$attachment->id}/preview")->assertOk()
        ->assertHeader('Content-Type', 'image/png')
        ->assertHeader('Content-Disposition', 'inline; filename=plan.png')
        ->assertHeader('X-Content-Type-Options', 'nosniff');

    $preview = (string) file_get_contents($response->baseResponse->getFile()->getPathname());
    expect(getimagesizefromstring($preview))->toMatchArray([0 => 1600, 1 => 800])
        // the original stays as it was
        ->and(getimagesize((string) $attachment->getFirstMedia('file')?->getPath()))->toMatchArray([0 => 2400, 1 => 1200]);
});

it('keeps the format of a PNG preview, transparency and all', function () use ($picture, $upload) {
    $project = Project::factory()->create();
    $mara = memberOf($project, ProjectRole::Member);

    $attachment = $upload($mara, $project, 'logo.png', $picture('png', 2000, 400));

    $response = $this->actingAs($mara)->get("/attachments/{$attachment->id}/preview")->assertOk()->assertHeader('Content-Type', 'image/png');
    $preview = (string) file_get_contents($response->baseResponse->getFile()->getPathname());
    $image = imagecreatefromstring($preview);

    expect((new finfo(FILEINFO_MIME_TYPE))->buffer($preview))->toBe('image/png')
        ->and($image)->not->toBeFalse()
        ->and(imagecolorsforindex($image, (int) imagecolorat($image, 0, 0))['alpha'])->toBe(127)
        ->and(imagecolorsforindex($image, (int) imagecolorat($image, 1599, 0))['alpha'])->toBe(0);
});

it('makes a preview of a JPEG and a WebP, never larger than 1600 pixels and never larger than the picture', function (string $format, string $name, int $width, int $height, array $size) use ($picture, $upload) {
    $project = Project::factory()->create();
    $mara = memberOf($project, ProjectRole::Member);

    $attachment = $upload($mara, $project, $name, $picture($format, $width, $height));

    $response = $this->actingAs($mara)->get("/attachments/{$attachment->id}/preview")->assertOk()->assertHeader('Content-Type', "image/{$format}");
    expect(getimagesizefromstring((string) file_get_contents($response->baseResponse->getFile()->getPathname())))->toMatchArray($size);
})->with([
    'a tall JPEG' => ['jpeg', 'foto.jpg', 900, 3200, [0 => 450, 1 => 1600]],
    'a WebP' => ['webp', 'bild.webp', 1800, 1800, [0 => 1600, 1 => 1600]],
    'a small JPEG' => ['jpeg', 'klein.jpeg', 640, 480, [0 => 640, 1 => 480]],
]);

it('makes the preview in the format of the content, whatever the name says (T7-M1)', function () use ($picture, $upload) {
    $project = Project::factory()->create();
    $mara = memberOf($project, ProjectRole::Member);
    // a PNG named like a JPEG, and one without an extension: both keep their transparency in the preview
    $named = $upload($mara, $project, 'scan.jpg', $picture('png', 1700, 100));
    $plain = $upload($mara, $project, 'scan', $picture('png', 1700, 100));
    // a JPEG named like a PNG
    $jpeg = $upload($mara, $project, 'foto.png', $picture('jpeg', 1700, 100));

    foreach ([[$named, 'image/png'], [$plain, 'image/png'], [$jpeg, 'image/jpeg']] as [$attachment, $type]) {
        $response = $this->actingAs($mara)->get("/attachments/{$attachment->id}/preview")->assertOk()->assertHeader('Content-Type', $type);
        expect((new finfo(FILEINFO_MIME_TYPE))->file($response->baseResponse->getFile()->getPathname()))->toBe($type);
        $this->actingAs($mara)->get("/attachments/{$attachment->id}")->assertOk()->assertHeader('Content-Type', $type);
    }
    // the name the client sent stays the attachment's
    expect($named->filename)->toBe('scan.jpg');
});

it('makes no preview of a GIF, an AVIF or a file that is no picture', function (string $name, string $format) use ($picture, $upload) {
    $project = Project::factory()->create();
    $mara = memberOf($project, ProjectRole::Member);
    Queue::fake();

    $attachment = $upload($mara, $project, $name, $format === 'pdf' ? "%PDF-1.4\n%%EOF\n" : $picture($format, 2400, 1200));

    Queue::assertNothingPushed();
    expect($attachment->getFirstMedia('file')?->hasGeneratedConversion('preview'))->toBeFalse();
})->with([
    'a GIF (it keeps its animation)' => ['tanz.gif', 'gif'],
    'an AVIF' => ['bild.avif', 'avif'],
    'a PDF' => ['angebot.pdf', 'pdf'],
]);

it('answers 404 for a preview that does not exist', function () use ($picture, $upload) {
    $project = Project::factory()->create();
    $mara = memberOf($project, ProjectRole::Member);
    $gif = $upload($mara, $project, 'tanz.gif', $picture('gif', 2400, 1200));

    $this->actingAs($mara)->get("/attachments/{$gif->id}/preview")->assertNotFound();
    $this->actingAs($mara)->get("/attachments/{$gif->id}")->assertOk()->assertHeader('Content-Type', 'image/gif');
    $this->actingAs($mara)->getJson("/api/v1/attachments/{$gif->id}")->assertJsonPath('data.preview_url', null);
    expect(Attachment::query()->sole()->mime)->toBe('image/gif');
});
