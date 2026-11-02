<?php

use App\RichText\Document;
use App\RichText\RichTextNames;
use Tests\Support\RichTextFixtures as F;
use Tests\TestCase;

// the texts of hidden references and images come from the translations
pest()->extend(TestCase::class);

$url = 'https://werkbuch.example.com';

$mail = fn (array $json, RichTextNames $names = new RichTextNames) => Document::fromJson($json)->toMailHtml($names, $url.'/');

it('renders a visible reference as a link with key and title', function () use ($mail, $url) {
    $html = $mail(F::doc(F::p('Siehe ', F::reference(F::ITEM) + ['marks' => [['type' => 'bold']]], '.')), new RichTextNames(items: [F::ITEM => ['key' => 'WEB-47', 'title' => 'Doppelte Mails']]));

    expect($html)->toBe('<p>Siehe <a target="_blank" rel="noopener noreferrer nofollow" href="'.$url.'/items/WEB-47"><strong>WEB-47 Doppelte Mails</strong></a>.</p>');
});

it('renders a hidden reference as hidden, without key or id', function () use ($mail) {
    app()->setLocale('de');
    $names = new RichTextNames(items: ['01jcweb0000000000000000048' => ['key' => 'WEB-48', 'title' => 'Andere']]);

    $html = $mail(F::doc(F::p('Siehe ', F::reference(F::ITEM), ' und ', F::reference(F::PAGE, 'page'), '.')), $names);

    expect($html)->toBe('<p>Siehe verborgen und verborgen.</p>')
        ->not->toContain(F::ITEM)->not->toContain(F::PAGE);
});

it('renders an image as a link, never as img', function () use ($mail, $url) {
    app()->setLocale('de');

    $html = $mail(F::doc(
        F::image(F::IMAGE, 'Screenshot'),
        ['type' => 'blockquote', 'content' => [F::image(F::FILE, null)]],
        F::image('01jcbefe0000000000000000ac', ''),
        F::p('Datei: ', F::file(F::FILE, 'protokoll.pdf'), ' ', F::file(F::IMAGE, null)),
    ), new RichTextNames(names: [F::FILE => 'foto.png']));

    expect($html)->toBe(
        '<p><a target="_blank" rel="noopener noreferrer nofollow" href="'.$url.'/attachments/'.F::IMAGE.'">Bild: Screenshot</a></p>'
        .'<blockquote><p><a target="_blank" rel="noopener noreferrer nofollow" href="'.$url.'/attachments/'.F::FILE.'">Bild: foto.png</a></p></blockquote>'
        .'<p><a target="_blank" rel="noopener noreferrer nofollow" href="'.$url.'/attachments/01jcbefe0000000000000000ac">Bild: 01jcbefe0000000000000000ac</a></p>'
        .'<p>Datei: <a target="_blank" rel="noopener noreferrer nofollow" href="'.$url.'/attachments/'.F::FILE.'">protokoll.pdf</a> '
        .'<a target="_blank" rel="noopener noreferrer nofollow" href="'.$url.'/attachments/'.F::IMAGE.'">'.F::IMAGE.'</a></p>'
    )->not->toContain('<img');
});

it('renders a mention with the name', function () use ($mail) {
    $html = $mail(
        F::doc(F::p(F::mention(F::MARA, 'mara-alt'), ', ', F::mention('01jcmax0000000000000000000', 'max'), ', ', F::mention('01jcweb0000000000000000048', 'lene'), ' und ', F::mention('01jcpage000000000000000000', null), '.')),
        new RichTextNames(handles: [F::MARA => 'mara', '01jcmax0000000000000000000' => 'max'], names: [F::MARA => 'Mara Feld']),
    );

    // the name, else the current handle, else the handle when it was written, else hidden
    expect($html)->toBe('<p>@Mara Feld, @max, @lene und hidden.</p>');
});

it('escapes names and titles', function () use ($mail) {
    $script = '<script>alert(1)</script>';

    $html = $mail(
        F::doc(F::p(F::mention(F::MARA, 'mara'), ' ', F::reference(F::ITEM), ' ', F::file(F::FILE, $script)), F::image(F::IMAGE, $script)),
        new RichTextNames(items: [F::ITEM => ['key' => 'WEB-47', 'title' => $script]], names: [F::MARA => $script]),
    );

    expect($html)->not->toContain('<script>')
        ->and(substr_count($html, '&lt;script&gt;alert(1)&lt;/script&gt;'))->toBe(4);
});

it('renders an empty document as nothing', function () use ($mail) {
    expect($mail(['type' => 'doc']))->toBe('');
});
