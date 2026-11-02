<?php

use App\RichText\Document;
use App\RichText\Markdown;
use App\RichText\MarkdownContext;
use App\RichText\RichTextNames;
use Tests\Support\FakeRichTextLookup;
use Tests\Support\RichTextFixtures as F;

// Kira exists but may not be mentioned here, Lene left the project; OPS-12 exists, but the writer does not see it
$lookup = new FakeRichTextLookup(['mara' => F::MARA], ['kira' => F::KIRA, 'lene' => F::LENE], ['WEB-47' => F::ITEM, 'OLD-47' => F::ITEM]);
$read = fn (string $markdown, array $kept = [], array $keptRefs = []): Document => Document::fromMarkdown($markdown, new MarkdownContext(null, $lookup, $kept, $keptRefs));
// every ID known to the reader, as the API gives them to someone who sees everything
$names = new RichTextNames(handles: [F::MARA => 'mara'], items: [F::ITEM => ['key' => 'WEB-47', 'title' => 'Doppelte Mails']]);

it('reads a mention and a key in a sentence', function () use ($read) {
    expect($read('Danke @mara, siehe (WEB-47), web-47 und OLD-47. #WEB-47')->toJson())->toBe(F::doc(F::p(
        'Danke ', F::mention(F::MARA, 'mara'), ', siehe (', F::reference(F::ITEM), '), ', F::reference(F::ITEM), ' und ', F::reference(F::ITEM), '. #', F::reference(F::ITEM),
    )));
});

it('reads a mention from Markdown without content', function () use ($read) {
    // the empty element tiptap-php reads, never `<span …>@mara</span>`, which would give the mention content
    expect($read('@mara')->toJson())->toBe(F::doc(F::p(F::mention(F::MARA, 'mara'))))
        ->and($read('**@mara**')->toJson())->toBe(F::doc(F::p(['type' => 'mention', 'attrs' => F::mention(F::MARA, 'mara')['attrs'], 'marks' => [['type' => 'bold']]])));
});

it('mentions nobody in a code block, inline code or a link text', function () use ($read) {
    $document = $read(implode("\n\n", [
        '`@mara WEB-47`',
        "```\n@mara WEB-47\n```",
        '    @mara WEB-47',
        '[@mara WEB-47](https://example.com)',
        'https://example.com/@mara/WEB-47 <https://example.com/WEB-47>',
        '![@mara WEB-47](https://example.com/a.png)',
    ]));

    expect($document->mentionedUserIds())->toBe([])
        ->and($document->itemRefs())->toBe([])
        ->and($document->toText())->toContain('@mara WEB-47');
});

it('leaves an unknown, a disabled or a foreign handle as text', function () use ($read) {
    expect($read('@kira @nobody @Mara @ma')->toJson())->toBe(F::doc(F::p('@kira @nobody @Mara @ma')));
});

it('keeps a kept mention of a former member through Markdown', function () use ($read) {
    // Lene may no longer be mentioned, but the text mentioned her before: an agent writing it back keeps her (K8)
    expect($read('@lene', [F::LENE])->toJson())->toBe(F::doc(F::p(F::mention(F::LENE, 'lene'))))
        ->and($read('@lene')->toJson())->toBe(F::doc(F::p('@lene')))
        ->and($read('@nobody', [F::LENE])->toJson())->toBe(F::doc(F::p('@nobody')));
});

it('leaves the key of an invisible item as text', function () use ($read) {
    expect($read('Siehe OPS-12 und WEB-48')->toJson())->toBe(F::doc(F::p('Siehe OPS-12 und WEB-48')))
        ->and($read('Siehe OPS-12', [], [F::OPS12])->toJson())->toBe(F::doc(F::p('Siehe OPS-12')));
});

it('leaves WEB-47x, xWEB-47 and an email address as text', function () use ($read) {
    $text = 'WEB-47x xWEB-47 1WEB-47 WEB-47-2 -WEB-47 WEB-47_ a_WEB-47 ü@mara @mara_ @maraX @mara-';
    // GitHub's autolink makes a link of the address, whose text is no mention
    $address = $read('mara@example.com');

    expect($read($text)->toJson())->toBe(F::doc(F::p($text)))
        ->and($address->mentionedUserIds())->toBe([])
        ->and($address->toText())->toBe('mara@example.com');
});

it('turns [x](item:<ulid>) into a reference only when the writer sees it or it was kept', function () use ($read) {
    $upper = strtoupper(F::ITEM);

    expect($read('[x](item:'.F::ITEM.') [y](item:'.$upper.')')->toJson())->toBe(F::doc(F::p(F::reference(F::ITEM), ' ', F::reference(F::ITEM))))
        ->and($read('[verborgen](item:'.F::OPS12.')')->toJson())->toBe(F::doc(F::p('verborgen')))
        ->and($read('[verborgen](item:'.F::OPS12.')', [], [F::OPS12])->toJson())->toBe(F::doc(F::p(F::reference(F::OPS12))))
        ->and($read('[kaputt](item:WEB-47) [Seite](page:'.F::PAGE.')')->toJson())->toBe(F::doc(F::p('kaputt Seite')))
        ->and(Document::fromMarkdown('[x](item:'.F::ITEM.') @mara WEB-47', new MarkdownContext)->toJson())->toBe(F::doc(F::p('x @mara WEB-47')))
        ->and(Document::fromMarkdown('[x](item:'.F::OPS12.')', new MarkdownContext(keptRefs: [F::OPS12]))->toJson())->toBe(F::doc(F::p(F::reference(F::OPS12))));
});

it('reads ![alt](attachment:<ulid>) as an image and [a.pdf](attachment:<ulid>) as a file', function () use ($read) {
    expect($read('![Screenshot](attachment:'.F::IMAGE.")\n\nDatei: [a.pdf](attachment:".strtoupper(F::FILE).')')->toJson())
        ->toBe(F::doc(F::image(F::IMAGE, 'Screenshot'), F::p('Datei: ', F::file(F::FILE, 'a.pdf'))))
        ->and($read('![](attachment:'.F::IMAGE.') [](attachment:'.F::FILE.')')->toJson())
        ->toBe(F::doc(F::image(F::IMAGE, null), F::p(F::file(F::FILE, null))))
        ->and($read('[a.pdf](attachment:../a.pdf)')->toJson())->toBe(F::doc(F::p('a.pdf')));
});

it('keeps ![x](https://…) out of the document as a node', function () use ($read) {
    // the alt text stays as text, with its marks
    expect($read('Logo: ![Das *Logo*](https://example.com/logo.png) ![Pfad](attachment:../a.png)')->toJson())
        ->toBe(F::doc(F::p('Logo: Das ', F::text('Logo', 'italic'), ' Pfad')));
});

it('reads an image inside a sentence as its own block between two paragraphs', function () use ($read) {
    $image = '![Bild](attachment:'.F::IMAGE.')';

    expect($read("Siehe {$image} hier")->toJson())->toBe(F::doc(F::p('Siehe'), F::image(F::IMAGE, 'Bild'), F::p('hier')))
        ->and($read("**fett {$image} weiter**")->toJson())->toBe(F::doc(F::p(F::text('fett', 'bold')), F::image(F::IMAGE, 'Bild'), F::p(F::text('weiter', 'bold'))))
        ->and($read("{$image}{$image}")->toJson())->toBe(F::doc(F::image(F::IMAGE, 'Bild'), F::image(F::IMAGE, 'Bild')))
        ->and($read("# Titel {$image}")->toJson())->toBe(F::doc(['type' => 'heading', 'attrs' => ['level' => 1], 'content' => [F::text('Titel')]], F::image(F::IMAGE, 'Bild')))
        ->and($read("> Zitat {$image}")->toJson())->toBe(F::doc(['type' => 'blockquote', 'content' => [F::p('Zitat'), F::image(F::IMAGE, 'Bild')]]));
});

it('reads an image inside a list item', function () use ($read) {
    $image = '![Bild](attachment:'.F::IMAGE.')';
    $list = fn (array ...$blocks) => F::doc(['type' => 'bulletList', 'content' => [['type' => 'listItem', 'content' => $blocks]]]);

    // a list item starts with a paragraph (Schema::CONTENT), an empty one if the image comes first
    expect($read("- Text {$image}")->toJson())->toBe($list(F::p('Text'), F::image(F::IMAGE, 'Bild')))
        ->and($read("- {$image}")->toJson())->toBe($list(['type' => 'paragraph'], F::image(F::IMAGE, 'Bild')))
        ->and($read("- {$image} Text")->toJson())->toBe($list(['type' => 'paragraph'], F::image(F::IMAGE, 'Bild'), F::p('Text')));
});

it('reads an image inside a table cell', function () use ($read) {
    $cell = fn (string $type, array ...$blocks) => ['type' => $type, 'attrs' => ['colspan' => 1, 'rowspan' => 1, 'colwidth' => null, 'align' => null], 'content' => $blocks];

    expect($read('| ![Bild](attachment:'.F::IMAGE.") |\n| --- |\n| a |")->toJson())->toBe(F::doc(['type' => 'table', 'content' => [
        ['type' => 'tableRow', 'content' => [$cell('tableHeader', F::image(F::IMAGE, 'Bild'))]],
        ['type' => 'tableRow', 'content' => [$cell('tableCell', F::p('a'))]],
    ]]));
});

it('writes a visible reference as its current key and a hidden one as [hidden](item:…)', function () use ($names) {
    $document = Document::fromJson(F::doc(F::p('Siehe ', F::reference(F::ITEM), ' und ', F::reference(F::OPS12), '.')));

    expect($document->toMarkdown($names))->toBe('Siehe WEB-47 und [hidden](item:'.F::OPS12.').')
        ->and($document->toMarkdown())->toBe('Siehe [hidden](item:'.F::ITEM.') und [hidden](item:'.F::OPS12.').');
});

it('writes a page reference as hidden and reads it back as text until Phase 9', function () use ($read, $names) {
    $markdown = Document::fromJson(F::doc(F::p(F::reference(F::PAGE, 'page'))))->toMarkdown($names);

    expect($markdown)->toBe('[hidden](page:'.F::PAGE.')')
        ->and($read($markdown, [], [F::PAGE])->toJson())->toBe(F::doc(F::p('hidden')));
});

it('writes a mention with the current handle', function () use ($names) {
    $document = Document::fromJson(F::doc(F::p(F::mention(F::MARA, 'mara-alt'), ' und ', F::mention(F::LENE, 'lene'), ['type' => 'mention', 'attrs' => ['id' => F::KIRA], 'marks' => [['type' => 'bold']]])));

    // without a name nor a label, a mention leaves nothing behind
    expect($document->toMarkdown($names))->toBe('@mara und @lene')
        ->and($document->toMarkdown())->toBe('@mara-alt und @lene');
});

it('reads its own Markdown back to the same JSON', function () use ($read, $names) {
    // every node of the schema, the ones of Phase 7 with marks, but no page reference: pages come with Phase 9
    $json = F::everyNode();
    $custom = F::customNodes();
    $json['content'][] = F::p(
        'Bitte ',
        ['type' => 'mention', 'attrs' => F::mention(F::MARA, 'mara')['attrs'], 'marks' => [['type' => 'bold']]],
        ' ansehen, siehe ',
        F::reference(F::ITEM),
        ' und ',
        ['type' => 'reference', 'attrs' => F::reference(F::OPS12)['attrs'], 'marks' => [['type' => 'italic']]],
        ': ',
        F::file(F::FILE, 'protokoll [final] *v2*.pdf'),
        '.',
    );
    $json['content'][] = $custom['content'][1];
    $json['content'][] = F::image(F::IMAGE, null);

    $markdown = Document::fromJson($json)->toMarkdown($names);

    expect($read($markdown, [], [F::OPS12])->toJson())->toBe($json)
        ->and($markdown)->toEndWith(implode("\n\n", [
            'Bitte **@mara** ansehen, siehe WEB-47 und *[hidden](item:'.F::OPS12.')*: [protokoll \\[final\\] \\*v2\\*.pdf](attachment:'.F::FILE.').',
            '![Screenshot des Formulars](attachment:'.F::IMAGE.')',
            '![](attachment:'.F::IMAGE.')',
        ]));
});

it('keeps a hidden reference through Markdown when it was kept', function () use ($read) {
    $json = F::doc(F::p('Siehe ', F::reference(F::OPS12)));
    $markdown = Document::fromJson($json)->toMarkdown();

    expect($read($markdown, [], [F::OPS12])->toJson())->toBe($json)
        ->and($read($markdown)->toJson())->toBe(F::doc(F::p('Siehe hidden')));
});

it('escapes a file name with </span><img src=x onerror=…> in toHtml and toMarkdown', function () use ($read) {
    $name = '</span><img src=x onerror=alert(1)>`~|&amp;\\';
    $json = F::doc(F::p(F::file(F::FILE, $name)), F::image(F::IMAGE, $name));
    $document = Document::fromJson($json);

    expect($document->toHtml())->not->toContain('<img src')
        // no `<` without a backslash: Markdown would read it as HTML
        ->and($document->toMarkdown())->not->toMatch('/(?<!\\\\)</')
        ->and($document->toMarkdown())->toStartWith('[\\</span\\>\\<img src=x onerror=alert(1)\\>\\`\\~\\|\\&amp;\\\\](attachment:')
        ->and($read($document->toMarkdown())->toJson())->toBe($json);
});

it('writes a file name or an alt text over several lines on one line', function () use ($read) {
    $document = Document::fromJson(F::doc(F::p(F::file(F::FILE, "a\n\nb.pdf")), F::image(F::IMAGE, "Zeile\neins")));

    expect($document->toMarkdown())->toBe('[a b.pdf](attachment:'.F::FILE.")\n\n![Zeile eins](attachment:".F::IMAGE.')')
        ->and($read($document->toMarkdown())->toJson())->toBe(F::doc(F::p(F::file(F::FILE, 'a b.pdf')), F::image(F::IMAGE, 'Zeile eins')))
        ->and($read("[a\nb.pdf](attachment:".F::FILE.')')->toJson())->toBe(F::doc(F::p(F::file(F::FILE, 'a b.pdf'))));
});

it('writes any other span as its text', function () {
    expect(Markdown::fromHtml('<p><span>a</span> <span data-type="mention" data-id="x">b</span></p>'))->toBe('a b');
});
