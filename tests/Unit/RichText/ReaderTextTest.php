<?php

use App\RichText\Document;
use App\RichText\RichTextNames;
use Tests\Support\RichTextFixtures as F;
use Tests\TestCase;

// the text of a hidden reference comes from the translations
pest()->extend(TestCase::class);

$doc = fn () => Document::fromJson(F::doc(
    F::p('Bitte ', F::mention(F::MARA, 'mara-alt'), ' und ', F::mention(F::LENE, 'lene'), ' ansehen, siehe ', F::reference(F::ITEM), ' und ', F::reference(F::OPS12), '.'),
    F::p('Ohne Label: ', F::mention(F::KIRA, null), F::reference(F::PAGE, 'page'), ' ', F::file(F::FILE, 'protokoll.pdf')),
));

it('writes the text for one reader: visible references with key and title, hidden ones as hidden, mentions with the name (K13)', function () use ($doc) {
    $names = new RichTextNames(
        handles: [F::MARA => 'mara', F::LENE => 'lene'],
        items: [F::ITEM => ['key' => 'WEB-47', 'title' => 'Doppelte Mails']],
        names: [F::MARA => 'Mara Feld'],
    );

    // the name, else the current handle, else the handle when it was written; a mention without any is hidden
    expect($doc()->toText($names))->toBe(
        "Bitte @Mara Feld und @lene ansehen, siehe WEB-47 Doppelte Mails und hidden.\nOhne Label: hiddenhidden protokoll.pdf"
    )->not->toContain('OPS-12');
});

it('writes the text without names as before: no key of any reference', function () use ($doc) {
    expect($doc()->toText())->toBe("Bitte @mara-alt und @lene ansehen, siehe und .\nOhne Label: protokoll.pdf");
});
