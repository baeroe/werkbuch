<?php

use App\Access\ProjectRole;
use App\Actions\Pages\ExportPagePdf;
use App\Actions\Pages\LinkPagePdf;
use App\Exceptions\Problem;
use App\Models\Attachment;
use App\Models\Page;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use App\Pdf\Gotenberg;
use App\Pdf\PdfUnavailable;
use Illuminate\Filesystem\Filesystem;
use Illuminate\Http\Client\Request;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;
use Tests\Support\RichTextFixtures as F;

/*
 * A wiki page as PDF (WEBU-4): the HTML for the reader that goes to Gotenberg (faked here; the real one renders in
 * tests/Integration/GotenbergTest.php), the subtree in the order of the tree, the limits, the refusals, the download
 * (`GET /pages/{page}/pdf`, session and tokens with `read`, ten a minute) and its link over REST. WEB (public) with Mara
 * as its admin and Lene as a viewer; OPS (private) with Mara as its admin; Ida is in neither.
 */

beforeEach(function () {
    Storage::fake('local');
    config(['werkbuch.pdf.gotenberg_url' => 'http://gotenberg.test:3000']);
});

$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara Lindqvist', 'handle' => 'mara']);
    $web = Project::factory()->identifier('WEB')->public()->member($mara, ProjectRole::Admin)->create(['name' => 'Website', 'lead_id' => $mara->id]);
    $ops = Project::factory()->identifier('OPS')->private()->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $lene = memberOf($web, ProjectRole::Viewer, ['name' => 'Lene Vogt', 'handle' => 'lene']);
    $ida = User::factory()->create(['name' => 'Ida', 'handle' => 'ida']);

    return compact('mara', 'web', 'ops', 'lene', 'ida');
};

/** Gotenberg answers a PDF and keeps the requests it got. */
$gotenberg = function (): ArrayObject {
    $requests = new ArrayObject;
    Http::fake(['*'.Gotenberg::ROUTE => function (Request $request) use ($requests) {
        $requests[] = $request;

        return Http::response('%PDF-1.7 fake', 200, ['Content-Type' => 'application/pdf']);
    }]);

    return $requests;
};

/** The HTML that went to Gotenberg as index.html. */
$htmlOf = function (Request $request): string {
    foreach ($request->data() as $part) {
        if (($part['filename'] ?? null) === 'index.html') {
            return (string) $part['contents'];
        }
    }

    throw new RuntimeException('no index.html');
};

$png = fn (int $width = 4, int $height = 4): string => (string) base64_decode(substr(imageDataUrl('png', $width, $height), strlen('data:image/png;base64,')), true);

$status = function (callable $call): ?int {
    try {
        $call();
    } catch (Problem $problem) {
        return $problem->getStatusCode();
    }

    return null;
};

it('renders the text for the reader: names of now, a hidden reference without key or title, pictures as data URLs', function () use ($world, $gotenberg, $htmlOf, $png) {
    $w = $world();
    $requests = $gotenberg();
    $visible = WorkItem::factory()->for($w['web'])->create(['title' => 'Anmeldung prüfen', 'created_by' => $w['mara']->id]);
    $secret = WorkItem::factory()->for($w['ops'])->create(['title' => 'Geheimer Umzug', 'created_by' => $w['mara']->id]);
    $page = Page::factory()->create(['project_id' => $w['web']->id, 'title' => 'Plan', 'emoji' => '🧭', 'updated_by' => $w['mara']->id]);
    $picture = Attachment::factory()->forPage($page)->stored($png(), 'image/png', 'skizze.png')->create(['uploaded_by' => $w['mara']->id]);
    $file = Attachment::factory()->forPage($page)->stored('Hallo', 'text/plain', 'notiz.txt')->create(['uploaded_by' => $w['mara']->id]);
    $page->forceFill(['content' => F::doc(
        F::p('Frag ', F::mention($w['lene']->id, 'old-handle'), ' zu ', F::reference($visible->id), ' und ', F::reference($secret->id), '.'),
        F::image($picture->id, 'Skizze'),
        F::p('Anhang: ', F::file($file->id, 'notiz.txt')),
    )])->save();

    $pdf = ExportPagePdf::run(actor($w['lene']), $page, []);
    $html = $htmlOf($requests[0]);

    expect($pdf)->toBe(['filename' => 'Plan.pdf', 'pdf' => '%PDF-1.7 fake'])
        ->and($requests)->toHaveCount(1)
        ->and($requests[0]->url())->toBe('http://gotenberg.test:3000'.Gotenberg::ROUTE)
        ->and($html)->toContain('<h1>Plan</h1>', '🧭', 'Website / Wiki', '@Lene Vogt', "{$visible->key} Anmeldung prüfen", (string) __('richtext.hidden'), 'notiz.txt')
        // the preview of the picture (the factory stores it as .bin: medialibrary writes its preview as JPEG)
        ->and($html)->toMatch('~<img src="data:image/(png|jpeg);base64,[A-Za-z0-9+/=]+" data-attachment-id="'.$picture->id.'" alt="Skizze">~')
        ->and($html)->toContain((string) __('wiki.page.changed', ['name' => 'Mara Lindqvist', 'day' => $page->updated_at?->isoFormat('LL')]))
        // what the reader does not see never reaches the PDF
        ->and($html)->not->toContain('Geheimer Umzug', $secret->key, 'old-handle', (string) __('pdf.toc'));
});

it('takes the subtree in the order of the tree, with a table of contents in front', function () use ($world, $gotenberg, $htmlOf) {
    $w = $world();
    $requests = $gotenberg();
    $root = Page::factory()->create(['project_id' => $w['web']->id, 'title' => 'Handbuch']);
    $second = Page::factory()->childOf($root)->create(['title' => 'Zweite', 'rank' => 'a1']);
    $first = Page::factory()->childOf($root)->create(['title' => 'Erste', 'rank' => 'a0']);
    Page::factory()->childOf($first)->create(['title' => 'Unter der ersten']);
    Page::factory()->create(['project_id' => $w['web']->id, 'title' => 'Daneben']);

    $link = LinkPagePdf::run(actor($w['lene']), $root, ['subpages' => '1']);
    ExportPagePdf::run(actor($w['lene']), $root, ['subpages' => '1']);
    $html = $htmlOf($requests[0]);
    $at = fn (string $title) => strpos($html, "<h1>{$title}</h1>");

    expect($link)->toBe(['url' => route('pages.pdf', ['page' => $root->id, 'subpages' => 1]), 'filename' => 'Handbuch.pdf', 'pages' => 4])
        ->and($html)->toContain((string) __('pdf.toc'), 'Handbuch / Erste')
        ->and($html)->not->toContain('Daneben')
        ->and($at('Handbuch'))->toBeLessThan($at('Erste'))
        ->and($at('Erste'))->toBeLessThan($at('Unter der ersten'))
        ->and($at('Unter der ersten'))->toBeLessThan($at('Zweite'))
        // one page alone: no contents, a link without the switch
        ->and(LinkPagePdf::run(actor($w['lene']), $second, ['subpages' => '1'])['pages'])->toBe(1)
        ->and(LinkPagePdf::run(actor($w['lene']), $root, [])['url'])->toBe(route('pages.pdf', ['page' => $root->id]));
});

it('refuses a subtree of more than MAX_PAGES pages, and a subpages that is no flag', function () use ($world, $gotenberg) {
    $w = $world();
    $gotenberg();
    $root = Page::factory()->create(['project_id' => $w['web']->id]);
    Page::factory()->count(ExportPagePdf::MAX_PAGES)->childOf($root)->create();

    expect(fn () => LinkPagePdf::run(actor($w['mara']), $root, ['subpages' => true]))
        ->toThrow(fn (ValidationException $e) => expect($e->errors())->toBe(['subpages' => [__('field.subpages.too_many', ['max' => ExportPagePdf::MAX_PAGES, 'count' => ExportPagePdf::MAX_PAGES + 1])]]))
        ->and(fn () => ExportPagePdf::run(actor($w['mara']), $root, ['subpages' => 'ja']))
        ->toThrow(fn (ValidationException $e) => expect(array_keys($e->errors()))->toBe(['subpages']))
        // the page alone is fine
        ->and(LinkPagePdf::run(actor($w['mara']), $root, ['subpages' => false])['pages'])->toBe(1);
    Http::assertNothingSent();
});

it('answers 404 for a page the reader does not see, as for an unknown one', function () use ($world, $gotenberg, $status) {
    $w = $world();
    $gotenberg();
    $hidden = Page::factory()->create(['project_id' => $w['ops']->id]);

    expect($status(fn () => ExportPagePdf::run(actor($w['ida']), $hidden, [])))->toBe(404)
        ->and($status(fn () => LinkPagePdf::run(actor($w['lene']), $hidden->id, [])))->toBe(404)
        ->and($status(fn () => LinkPagePdf::run(actor($w['lene']), 'no-page', [])))->toBe(404);
    Http::assertNothingSent();
});

it('says pdf_unavailable without Gotenberg, and when it fails or answers no PDF, reporting the cause', function (Closure $answer) use ($world) {
    $w = $world();
    $page = Page::factory()->create(['project_id' => $w['web']->id]);
    $logged = [];
    Event::listen(MessageLogged::class, function (MessageLogged $message) use (&$logged) {
        $logged[] = $message->context['exception'] ?? null;
    });
    Http::fake(['*'.Gotenberg::ROUTE => $answer]);

    expect(fn () => ExportPagePdf::run(actor($w['mara']), $page, []))
        ->toThrow(fn (Problem $problem) => expect([$problem->getStatusCode(), $problem->reason])->toBe([503, 'pdf_unavailable']))
        ->and(collect($logged)->filter(fn ($e) => $e instanceof PdfUnavailable))->toHaveCount(1);
})->with([
    'an error' => [fn () => fn () => Http::response('Chromium failed', 500)],
    'no PDF' => [fn () => fn () => Http::response('<html>proxy</html>', 200)],
    'no connection' => [fn () => fn (Request $request) => Http::failedConnection('cURL error 28: timed out')($request)],
]);

it('says pdf_unavailable without a URL, before asking anyone', function () use ($world, $status) {
    $w = $world();
    config(['werkbuch.pdf.gotenberg_url' => null]);
    Http::fake();
    $page = Page::factory()->create(['project_id' => $w['web']->id]);

    expect($status(fn () => ExportPagePdf::run(actor($w['mara']), $page, [])))->toBe(503)
        ->and($status(fn () => LinkPagePdf::run(actor($w['mara']), $page, [])))->toBe(503);
    Http::assertNothingSent();
});

it('leaves out a picture of another project and one over the limit, as a line with its name', function () use ($world, $gotenberg, $htmlOf, $png) {
    $w = $world();
    $requests = $gotenberg();
    $page = Page::factory()->create(['project_id' => $w['web']->id]);
    $foreign = Attachment::factory()->stored($png(), 'image/png', 'fremd.png')->create(['project_id' => $w['ops']->id, 'uploaded_by' => $w['mara']->id]);
    $big = Attachment::factory()->forPage($page)->stored(str_repeat('x', ExportPagePdf::IMAGE_MAX_BYTES + 1), 'image/png', 'gross.png')->create(['uploaded_by' => $w['mara']->id]);
    $page->forceFill(['content' => F::doc(F::image($foreign->id, 'Fremd'), F::image($big->id, 'Groß'))])->save();

    ExportPagePdf::run(actor($w['mara']), $page, []);
    $html = $htmlOf($requests[0]);

    expect($html)->not->toContain('data:image')
        ->and($html)->toContain((string) __('richtext.image', ['name' => 'Fremd']), (string) __('richtext.image', ['name' => 'Groß']));
});

it('sends the fonts of the build beside the HTML', function () use ($world, $gotenberg) {
    $w = $world();
    $requests = $gotenberg();
    $public = sys_get_temp_dir().'/werkbuch-public-'.bin2hex(random_bytes(4));
    mkdir($public.'/build/assets', 0777, true);
    file_put_contents($public.'/build/assets/figtree-latin-wght-normal-AbCd1234.woff2', 'wOF2 figtree');
    app()->usePublicPath($public);
    $page = Page::factory()->create(['project_id' => $w['web']->id]);

    try {
        ExportPagePdf::run(actor($w['mara']), $page, []);
    } finally {
        (new Filesystem)->deleteDirectory($public);
    }

    $files = array_column(array_filter($requests[0]->data(), fn (array $part) => isset($part['filename'])), 'contents', 'filename');
    expect(array_keys($files))->toBe(['index.html', 'figtree-latin.woff2'])
        ->and($files['figtree-latin.woff2'])->toBe('wOF2 figtree');
});

it('names the file after the page, without what a file name cannot carry', function () {
    $page = new Page(['title' => 'Plan: A/B "neu"?']);
    $empty = new Page(['title' => '/:*']);

    expect(ExportPagePdf::filename($page))->toBe('Plan  A B  neu.pdf')
        ->and(ExportPagePdf::filename($empty))->toBe('werkbuch.pdf');
});

it('downloads the PDF with the session or a token with read, ten a minute per account', function () use ($world, $gotenberg) {
    $w = $world();
    $gotenberg();
    $page = Page::factory()->create(['project_id' => $w['web']->id, 'title' => 'Prüfplan']);

    $response = $this->actingAs($w['lene'])->get("/pages/{$page->id}/pdf");
    $response->assertOk()->assertHeader('Content-Type', 'application/pdf')->assertHeader('X-Content-Type-Options', 'nosniff');
    expect($response->getContent())->toBe('%PDF-1.7 fake')
        ->and($response->headers->get('Content-Disposition'))->toBe("attachment; filename=Prufplan.pdf; filename*=utf-8''Pr%C3%BCfplan.pdf")
        ->and($response->headers->get('Cache-Control'))->toContain('no-store');
    for ($i = 2; $i <= 10; $i++) {
        $this->get("/pages/{$page->id}/pdf")->assertOk();
    }
    $this->get("/pages/{$page->id}/pdf")->assertStatus(429);

    forgetApiAuth();
    $this->withToken(apiToken($w['mara'], ['read']))->get("/pages/{$page->id}/pdf")->assertOk();
    forgetApiAuth();
    $this->withToken(apiToken($w['mara'], ['write']))->get("/pages/{$page->id}/pdf")->assertForbidden();
    forgetApiAuth();
    $hidden = Page::factory()->create(['project_id' => $w['ops']->id]);
    $this->withToken(apiToken($w['ida'], ['read']))->get("/pages/{$hidden->id}/pdf")->assertNotFound();
});

it('links the PDF over REST, and says pdf_unavailable there too', function () use ($world, $gotenberg) {
    $w = $world();
    $gotenberg();
    $page = Page::factory()->create(['project_id' => $w['web']->id, 'title' => 'Plan']);
    Page::factory()->childOf($page)->create();
    $token = apiToken($w['lene'], ['read']);

    $this->withToken($token)->getJson("/api/v1/pages/{$page->id}/pdf?subpages=1")
        ->assertOk()
        ->assertExactJson(['data' => ['url' => route('pages.pdf', ['page' => $page->id, 'subpages' => 1]), 'filename' => 'Plan.pdf', 'pages' => 2]]);
    $this->withToken($token)->getJson("/api/v1/pages/{$page->id}/pdf?subpages=nein")->assertUnprocessable()->assertJsonPath('errors.subpages.0', __('field.boolean'));

    config(['werkbuch.pdf.gotenberg_url' => null]);
    $this->withToken($token)->getJson("/api/v1/pages/{$page->id}/pdf")->assertStatus(503)->assertJsonPath('reason', 'pdf_unavailable');
    Http::assertNothingSent();
});

it('refuses to render without a URL', function () {
    Http::fake();

    expect(fn () => (new Gotenberg(null, 5))->render('<p>x</p>'))->toThrow(PdfUnavailable::class, 'not configured');
    Http::assertNothingSent();
});
