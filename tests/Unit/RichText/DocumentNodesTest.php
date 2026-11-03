<?php

use App\RichText\Document;
use App\RichText\InvalidDocument;
use Tests\Support\RichTextFixtures as F;

$reason = function (array $json): ?string {
    try {
        Document::fromJson($json);
    } catch (InvalidDocument $invalid) {
        return $invalid->reason;
    }

    return null;
};

it('reads a mention, a reference, an image and a file as the editor writes them', function () {
    // `editor.getJSON()` of the editor: the reference carries the label of its suggestion, the image Tiptap's attributes
    $sent = F::doc(
        F::p(
            'Bitte ',
            ['type' => 'mention', 'attrs' => ['id' => F::MARA, 'label' => 'mara', 'mentionSuggestionChar' => '#']],
            ' ansehen, siehe ',
            ['type' => 'reference', 'attrs' => ['id' => F::ITEM, 'label' => 'WEB-47 Doppelte Mails', 'mentionSuggestionChar' => '@', 'kind' => 'item']],
            ' und ',
            ['type' => 'reference', 'attrs' => ['id' => F::PAGE, 'label' => 'Release-Plan', 'mentionSuggestionChar' => '#', 'kind' => 'page']],
            ': ',
            ['type' => 'attachment', 'attrs' => ['attachmentId' => F::FILE, 'filename' => 'protokoll.pdf']],
            '.',
        ),
        ['type' => 'image', 'attrs' => ['attachmentId' => F::IMAGE, 'alt' => 'Screenshot des Formulars', 'src' => null, 'title' => null, 'width' => null, 'height' => null]],
    );

    expect(Document::fromJson($sent)->toJson())->toBe(F::customNodes())
        ->and(Document::fromJson(F::customNodes())->toJson())->toBe(F::customNodes());
});

it('takes a missing kind as an item and a missing label as none', function () {
    $sent = F::doc(F::p(['type' => 'reference', 'attrs' => ['id' => F::ITEM]], ['type' => 'mention', 'attrs' => ['id' => F::MARA]]));

    expect(Document::fromJson($sent)->toJson())->toBe(F::doc(F::p(F::reference(F::ITEM), F::mention(F::MARA, null))));
});

it('lowers the ULIDs of the nodes', function () {
    $sent = F::doc(
        F::p(F::mention(strtoupper(F::MARA), 'mara'), F::reference(strtoupper(F::ITEM)), F::file(strtoupper(F::FILE), 'a.pdf')),
        F::image(strtoupper(F::IMAGE), null),
    );

    expect(Document::fromJson($sent)->toJson())->toBe(F::doc(
        F::p(F::mention(F::MARA, 'mara'), F::reference(F::ITEM), F::file(F::FILE, 'a.pdf')),
        F::image(F::IMAGE, null),
    ));
});

it('refuses a node without an id or with a bad ULID', function (array $node) use ($reason) {
    $doc = $node['type'] === 'image' ? F::doc($node) : F::doc(F::p($node));

    expect($reason($doc))->toBe('shape');
})->with([
    'a mention without an id' => [['type' => 'mention', 'attrs' => ['label' => 'mara']]],
    'a mention with a handle as id' => [['type' => 'mention', 'attrs' => ['id' => 'mara']]],
    'a mention with a number as id' => [['type' => 'mention', 'attrs' => ['id' => 42]]],
    'a reference without an id' => [['type' => 'reference', 'attrs' => ['kind' => 'item']]],
    'a reference with a key as id' => [['type' => 'reference', 'attrs' => ['id' => 'WEB-47']]],
    'a reference of an unknown kind' => [['type' => 'reference', 'attrs' => ['id' => F::ITEM, 'kind' => 'view']]],
    'a file without an id' => [['type' => 'attachment', 'attrs' => ['filename' => 'a.pdf']]],
    'a file with a path' => [['type' => 'attachment', 'attrs' => ['attachmentId' => '../a.pdf']]],
    'an image without an id' => [['type' => 'image', 'attrs' => ['src' => 'https://example.com/a.png']]],
    'an image with a ULID of an I' => [['type' => 'image', 'attrs' => ['attachmentId' => '01jcimage00000000000000000']]],
    'a file name that is no text' => [['type' => 'attachment', 'attrs' => ['attachmentId' => F::FILE, 'filename' => ['a.pdf']]]],
    'a mention with content' => [['type' => 'mention', 'attrs' => ['id' => F::MARA], 'content' => [F::text('@mara')]]],
    'an image with content' => [['type' => 'image', 'attrs' => ['attachmentId' => F::IMAGE], 'content' => [F::p('Bild')]]],
    'an image with marks' => [['type' => 'image', 'attrs' => ['attachmentId' => F::IMAGE], 'marks' => [['type' => 'bold']]]],
]);

it('refuses a mention in a code block and an image in a paragraph', function () use ($reason) {
    expect($reason(F::doc(['type' => 'codeBlock', 'attrs' => ['language' => null], 'content' => [F::mention(F::MARA, 'mara')]])))->toBe('shape')
        ->and($reason(F::doc(F::p('Bild: ', F::image(F::IMAGE, null)))))->toBe('shape')
        ->and($reason(F::doc(F::file(F::FILE, 'a.pdf'))))->toBe('shape')
        ->and($reason(F::doc(['type' => 'blockquote', 'content' => [F::image(F::IMAGE, null)]])))->toBeNull()
        ->and($reason(F::doc(['type' => 'heading', 'attrs' => ['level' => 2], 'content' => [F::mention(F::MARA, 'mara'), F::reference(F::ITEM), F::file(F::FILE, 'a.pdf')]])))->toBeNull();
});

it('keeps the marks of a mention, a reference and a file in bold text', function () {
    $bold = [['type' => 'bold']];
    $sent = F::doc(F::p(
        ['type' => 'text', 'marks' => $bold, 'text' => 'Bitte '],
        F::mention(F::MARA, 'mara') + ['marks' => $bold],
        F::reference(F::ITEM) + ['marks' => [['type' => 'italic'], ['type' => 'bold']]],
        F::file(F::FILE, 'a.pdf') + ['marks' => $bold],
    ));

    expect(Document::fromJson($sent)->toJson()['content'][0]['content'])->toBe([
        ['type' => 'text', 'marks' => $bold, 'text' => 'Bitte '],
        ['type' => 'mention', 'attrs' => F::mention(F::MARA, 'mara')['attrs'], 'marks' => $bold],
        ['type' => 'reference', 'attrs' => F::reference(F::ITEM)['attrs'], 'marks' => [['type' => 'bold'], ['type' => 'italic']]],
        ['type' => 'attachment', 'attrs' => F::file(F::FILE, 'a.pdf')['attrs'], 'marks' => $bold],
    ]);
});

it('names mentions, attachments, item and page references once each in order', function () {
    $other = '01jcmax0000000000000000000';
    $second = '01jcweb0000000000000000048';
    $doc = Document::fromJson(F::doc(
        F::p(F::mention($other, 'max'), ' ', F::reference($second), ' ', F::file(F::FILE, 'a.pdf')),
        F::image(F::IMAGE, null),
        ['type' => 'bulletList', 'content' => [['type' => 'listItem', 'content' => [
            F::p(F::mention(F::MARA, 'mara'), ' ', F::mention(strtoupper($other), 'max'), ' ', F::reference(F::ITEM), ' ', F::reference(F::PAGE, 'page'), ' ', F::reference($second)),
            F::image(F::FILE, null),
        ]]]],
    ));

    expect($doc->mentionedUserIds())->toBe([$other, F::MARA])
        ->and($doc->attachmentIds())->toBe([F::FILE, F::IMAGE])
        ->and($doc->itemRefs())->toBe([$second, F::ITEM])
        ->and($doc->pageRefs())->toBe([F::PAGE])
        ->and(Document::fromJson(F::everyNode())->mentionedUserIds())->toBe([]);
});

it('counts a document with only an image as not empty', function () {
    expect(Document::fromJson(F::doc(F::image(F::IMAGE, null)))->isEmpty())->toBeFalse()
        ->and(Document::fromJson(F::doc(F::p(F::mention(F::MARA, null))))->isEmpty())->toBeFalse()
        ->and(Document::fromJson(F::doc(F::p(F::reference(F::ITEM))))->isEmpty())->toBeFalse()
        ->and(Document::fromJson(F::doc(F::p(' ', F::file(F::FILE, null))))->isEmpty())->toBeFalse()
        ->and(Document::fromJson(F::doc(F::p(' ')))->isEmpty())->toBeTrue();
});

it('writes the text of the nodes', function () {
    $doc = Document::fromJson(F::doc(
        ...F::customNodes()['content'],
        ...[F::p('Ohne Label: ', F::mention(F::MARA, null), F::reference(F::ITEM), ' ', F::file(F::FILE, null)), F::image(F::IMAGE, null)],
    ));

    // a node without text leaves no double space between the words around it (T14-M7)
    expect($doc->toText())->toBe("Bitte @mara ansehen, siehe und : protokoll.pdf.\nScreenshot des Formulars\nOhne Label: ")
        ->and(Document::fromJson(F::doc(F::p('mit ', F::reference(F::ITEM), ' zusammenhängt, ', F::reference(F::ITEM), '.')))->toText())
        ->toBe('mit zusammenhängt, .');
});

it('maps nodes with withNodes into nodes, text or nothing', function () {
    $doc = Document::fromJson(F::doc(
        F::p(
            ['type' => 'text', 'marks' => [['type' => 'bold']], 'text' => 'Bitte '],
            F::mention(F::MARA, 'mara') + ['marks' => [['type' => 'bold']]],
            ' ansehen, siehe ',
            F::reference(F::ITEM),
            ' und ',
            F::reference(F::PAGE, 'page'),
            '.',
            F::file(F::FILE, 'alt.pdf'),
        ),
        ['type' => 'blockquote', 'content' => [F::image(F::IMAGE, 'Screenshot')]],
        F::image(F::FILE, null),
    ));
    $seen = [];

    $mapped = $doc->withNodes(function (array $node) use (&$seen): array|string|null {
        $seen[] = $node['type'];

        return match ($node['type']) {
            'mention' => '@mara',
            'reference' => $node['attrs']['kind'] === 'item' ? 'WEB-47' : null,
            'attachment' => ['type' => 'attachment', 'attrs' => ['attachmentId' => strtoupper(F::FILE), 'filename' => 'protokoll.pdf']],
            'image' => $node['attrs']['alt'] ?? '',
        };
    });

    expect($seen)->toBe(['mention', 'reference', 'reference', 'attachment', 'image', 'image'])
        ->and($mapped->toJson())->toBe(F::doc(
            // the text takes the marks of the node and joins its neighbours
            F::p(['type' => 'text', 'marks' => [['type' => 'bold']], 'text' => 'Bitte @mara'], ' ansehen, siehe WEB-47 und .', F::file(F::FILE, 'protokoll.pdf')),
            // an image is a block: its text becomes a paragraph, no text takes it away
            ['type' => 'blockquote', 'content' => [F::p('Screenshot')]],
        ))
        ->and($doc->toJson()['content'][2])->toBe(F::image(F::FILE, null));
});

it('reads what withNodes builds like any document', function () {
    $doc = Document::fromJson(F::doc(F::p(F::mention(F::MARA, 'mara'))));

    expect(fn () => $doc->withNodes(fn () => ['type' => 'mention', 'attrs' => ['id' => 'mara']]))
        ->toThrow(InvalidDocument::class);
});

it('renders HTML without src or path', function () {
    $html = Document::fromJson(F::customNodes())->toHtml();

    expect($html)->toBe(
        '<p>Bitte <span data-type="mention" data-id="'.F::MARA.'" data-label="mara"></span> ansehen, siehe '
        .'<span data-type="reference" data-id="'.F::ITEM.'" data-kind="item"></span> und '
        .'<span data-type="reference" data-id="'.F::PAGE.'" data-kind="page"></span>: '
        .'<span data-type="attachment" data-attachment-id="'.F::FILE.'" data-filename="protokoll.pdf"></span>.</p>'
        .'<img data-attachment-id="'.F::IMAGE.'" alt="Screenshot des Formulars">'
    )->not->toContain('src=')->not->toContain('/attachments');
});

it('escapes a file name with </span><img src=x onerror=…> in toHtml', function () {
    $evil = '</span><img src=x onerror=alert(1)>"';
    $html = Document::fromJson(F::doc(
        F::p(F::file(F::FILE, $evil), F::mention(F::MARA, $evil)),
        F::image(F::IMAGE, $evil),
    ))->toHtml();

    expect($html)->not->toContain('<img src')->not->toContain('</span><img')
        ->and(substr_count($html, '<img'))->toBe(1)
        ->and($html)->toContain('data-filename="&lt;/span&gt;&lt;img src=x onerror=alert(1)&gt;&quot;"');
});
