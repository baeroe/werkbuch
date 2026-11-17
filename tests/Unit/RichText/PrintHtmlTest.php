<?php

use App\RichText\Document;
use App\RichText\RichTextNames;
use Tests\Support\RichTextFixtures as F;
use Tests\TestCase;

// the texts of hidden references and images come from the translations
pest()->extend(TestCase::class);

/*
 * The HTML of a printed wiki page (WEBU-4): like the mail (toMailHtml), but a picture the caller gives a data: URL for
 * stays a picture with that source; any other is the line of the mail.
 */

$url = 'https://werkbuch.example.com';

$print = fn (array $json, array $images, RichTextNames $names = new RichTextNames) => Document::fromJson($json)->toPrintHtml($names, $url.'/', $images);

it('keeps a picture the caller gives a data URL for, with that source', function () use ($print) {
    $html = $print(F::doc(F::image(F::IMAGE, 'Skizze "A"')), [F::IMAGE => 'data:image/png;base64,iVBOR="x"']);

    expect($html)->toBe('<img src="data:image/png;base64,iVBOR=&quot;x&quot;" data-attachment-id="'.F::IMAGE.'" alt="Skizze &quot;A&quot;">');
});

it('writes any other picture as the line of the mail, and mentions, references and files like the mail', function () use ($print, $url) {
    app()->setLocale('de');
    $names = new RichTextNames(handles: [F::MARA => 'mara'], items: [F::ITEM => ['key' => 'WEB-47', 'title' => 'Doppelte Mails']], names: [F::MARA => 'Mara Lindqvist']);
    $json = F::doc(
        F::p('Frag ', F::mention(F::MARA, 'alt'), ' zu ', F::reference(F::ITEM), ' und ', F::reference(F::OPS12), '.'),
        F::image(F::IMAGE, 'Skizze'),
        F::p(F::file(F::FILE, 'plan.pdf')),
    );

    $html = $print($json, [], $names);

    expect($html)->toBe(Document::fromJson($json)->toMailHtml($names, $url))
        ->toContain('@Mara Lindqvist', 'WEB-47 Doppelte Mails', 'verborgen', 'Bild: Skizze', 'plan.pdf')
        ->not->toContain('data:');
});

it('never takes a source from the text, only from the caller', function () use ($print) {
    $html = $print(F::doc(F::image(F::IMAGE, 'Skizze')), ['01jcother000000000000000000' => 'data:image/png;base64,AAA']);

    expect($html)->not->toContain('src=');
});
