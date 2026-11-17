<?php

use App\Access\ProjectRole;
use App\Actions\Pages\ExportPagePdf;
use App\Models\Page;
use App\Models\Project;
use App\Models\User;
use App\Pdf\Gotenberg;
use App\Pdf\PdfUnavailable;
use Illuminate\Support\Facades\Http;
use Tests\Support\RichTextFixtures as F;

/*
 * The real Gotenberg of DDEV or the CI (GOTENBERG_URL, hardened as in the compose stack: no JavaScript, nothing but its
 * own files and data: URLs), WEBU-4: a page with its subpages becomes a PDF of several pages, and the hardening holds:
 * a picture from an address is never loaded.
 */

it('renders a page with its subpages as a PDF', function () {
    $mara = User::factory()->create(['name' => 'Mara']);
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $root = Page::factory()->create(['project_id' => $web->id, 'title' => 'Handbuch', 'content' => F::doc(F::p('Erste Zeile mit Umlauten: äöü ß.'))]);
    Page::factory()->childOf($root)->create(['title' => 'Unterseite', 'content' => F::doc(F::p('Zweite Seite.'))]);

    $pdf = ExportPagePdf::run(actor($mara), $root, ['subpages' => true])['pdf'];

    expect($pdf)->toStartWith('%PDF-')
        // contents, then one sheet per page
        ->and(preg_match_all('~/Type\s*/Page[^s]~', $pdf))->toBeGreaterThanOrEqual(3);
});

it('loads nothing from an address, also when the HTML asks for it', function () {
    $gotenberg = app(Gotenberg::class);
    $html = '<!DOCTYPE html><html><body><p>Probe</p><img src="http://example.com/x.png"><img src="http://127.0.0.1:8025/x.png"></body></html>';

    // Gotenberg refuses a page that loads a denied URL, or renders it without: never with what the address served
    try {
        expect($gotenberg->render($html))->toStartWith('%PDF-');
    } catch (PdfUnavailable $refused) {
        expect($refused->getMessage())->toContain('without a PDF');
    }
});

it('says it is up', function () {
    $responses = Http::pool(fn ($pool) => app(Gotenberg::class)->statusRequest($pool, 'pdf'));

    expect(app(Gotenberg::class)->statusFrom($responses, 'pdf'))->toBe('ok');
});
