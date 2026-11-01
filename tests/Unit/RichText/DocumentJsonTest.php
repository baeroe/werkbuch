<?php

use App\RichText\Document;
use App\RichText\InvalidDocument;
use App\RichText\Schema;
use Tests\Support\RichTextFixtures as F;

$reason = function (array $json): ?string {
    try {
        Document::fromJson($json);
    } catch (InvalidDocument $invalid) {
        return $invalid->reason;
    }

    return null;
};

$nested = function (int $levels): array {
    $node = F::p('tief');
    for ($i = 0; $i < $levels; $i++) {
        $node = ['type' => 'blockquote', 'content' => [$node]];
    }

    return F::doc($node);
};

it('keeps a document of every standard node as it is', function () {
    expect(Document::fromJson(F::everyNode())->toJson())->toBe(F::everyNode())
        ->and(Document::fromJson(F::web47Steps())->toJson())->toBe(F::web47Steps());
});

it('has every node and mark of the schema in the fixture', function () {
    $found = ['nodes' => [], 'marks' => []];
    $walk = function (array $node) use (&$walk, &$found): void {
        $found['nodes'][] = $node['type'];
        foreach ($node['marks'] ?? [] as $mark) {
            $found['marks'][] = $mark['type'];
        }
        foreach ($node['content'] ?? [] as $child) {
            $walk($child);
        }
    };
    $walk(F::everyNode());

    expect(array_values(array_diff(Schema::NODES, $found['nodes'])))->toBe([])
        ->and(array_values(array_diff(Schema::MARKS, $found['marks'])))->toBe([]);
});

it('reads attributes as the editor does: defaults for missing ones, unknown ones dropped', function () {
    $sent = F::doc(
        ['type' => 'orderedList', 'attrs' => ['start' => 1], 'content' => [['type' => 'listItem', 'attrs' => ['color' => 'red'], 'content' => [['type' => 'paragraph', 'attrs' => []]]]]],
        ['type' => 'heading', 'content' => [['type' => 'text', 'marks' => [['type' => 'link', 'attrs' => ['href' => 'mailto:mara@example.com', 'data' => 1]], ['type' => 'bold', 'attrs' => ['x' => 1]]], 'text' => 'Mara']]],
        ['type' => 'paragraph', 'content' => []],
    );

    expect(Document::fromJson($sent)->toJson())->toBe(F::doc(
        ['type' => 'orderedList', 'attrs' => ['start' => 1, 'type' => null], 'content' => [['type' => 'listItem', 'content' => [['type' => 'paragraph']]]]],
        ['type' => 'heading', 'attrs' => ['level' => 1], 'content' => [['type' => 'text', 'marks' => [['type' => 'link', 'attrs' => F::link('mailto:mara@example.com')], ['type' => 'bold']], 'text' => 'Mara']]],
        ['type' => 'paragraph'],
    ));
});

it('refuses an unknown node', function () use ($reason) {
    // Phase 7 takes mentions in
    expect($reason(F::doc(F::p(['type' => 'mention', 'attrs' => ['id' => 'x']]))))->toBe('node')
        ->and($reason(F::doc(['type' => 'image'])))->toBe('node');
});

it('refuses an unknown mark', function () use ($reason) {
    expect($reason(F::doc(F::p(F::text('unterstrichen', 'underline')))))->toBe('mark');
});

it('refuses a document that is not a doc', function () use ($reason) {
    expect($reason(['type' => 'paragraph']))->toBe('shape')
        ->and($reason([]))->toBe('shape');
});

it('refuses a document of the wrong shape', function (array $json) use ($reason) {
    expect($reason($json))->toBe('shape');
})->with([
    'a node that is no object' => [['type' => 'doc', 'content' => ['absatz']]],
    'a node without a type' => [F::doc(['content' => []])],
    'a key no node has' => [F::doc(['type' => 'paragraph', 'marks' => []])],
    'a block where text belongs' => [F::doc(F::p(F::p('x')))],
    'a list item outside of a list' => [F::doc(['type' => 'listItem', 'content' => [F::p('x')]])],
    'content in a leaf' => [F::doc(['type' => 'horizontalRule', 'content' => [F::p('x')]])],
    'a doc in a doc' => [F::doc(F::doc())],
    'content that is no list' => [['type' => 'doc', 'content' => ['first' => F::p('x')]]],
    'an empty text' => [F::doc(F::p(['type' => 'text', 'text' => '']))],
    'a text without text' => [F::doc(F::p(['type' => 'text']))],
    'content in a text' => [F::doc(F::p(['type' => 'text', 'text' => 'x', 'content' => []]))],
    'marks that are no list' => [F::doc(F::p(['type' => 'text', 'text' => 'x', 'marks' => 'bold']))],
    'a mark that is no object' => [F::doc(F::p(['type' => 'text', 'text' => 'x', 'marks' => ['bold']]))],
    'a mark with a key marks lack' => [F::doc(F::p(['type' => 'text', 'text' => 'x', 'marks' => [['type' => 'bold', 'text' => 'x']]]))],
    'a mark in code' => [F::doc(['type' => 'codeBlock', 'content' => [F::text('x', 'bold')]])],
    'attributes that are no object' => [F::doc(['type' => 'heading', 'attrs' => 'h2', 'content' => [F::text('x')]])],
    'a heading level beyond three' => [F::doc(['type' => 'heading', 'attrs' => ['level' => 4], 'content' => [F::text('x')]])],
    'a list type that is no text' => [F::doc(['type' => 'orderedList', 'attrs' => ['type' => 1], 'content' => []])],
    'a checked that is text' => [F::doc(['type' => 'taskList', 'content' => [['type' => 'taskItem', 'attrs' => ['checked' => 'true'], 'content' => [F::p('x')]]]])],
    'an unknown alignment' => [F::doc(['type' => 'table', 'content' => [['type' => 'tableRow', 'content' => [['type' => 'tableCell', 'attrs' => ['align' => 'justify']]]]]])],
    'a link title that is no text' => [F::doc(F::p(['type' => 'text', 'text' => 'x', 'marks' => [['type' => 'link', 'attrs' => ['href' => 'https://example.com', 'title' => 1]]]]))],
]);

it('gives an odd list start, cell span, cell width or code language its default, as pasted HTML brings them', function (string $node, array $attrs, array $expected) {
    $cell = fn (string $type, array $attrs) => F::doc(['type' => 'table', 'content' => [['type' => 'tableRow', 'content' => [['type' => $type, 'attrs' => $attrs, 'content' => [F::p('x')]]]]]]);
    $json = match ($node) {
        'orderedList' => F::doc(['type' => 'orderedList', 'attrs' => $attrs, 'content' => [['type' => 'listItem', 'content' => [F::p('x')]]]]),
        'codeBlock' => F::doc(['type' => 'codeBlock', 'attrs' => $attrs, 'content' => [F::text('x')]]),
        default => $cell($node, $attrs),
    };
    $read = Document::fromJson($json)->toJson()['content'][0];
    $attrsOf = $node === 'orderedList' || $node === 'codeBlock' ? $read['attrs'] : $read['content'][0]['content'][0]['attrs'];

    expect(array_intersect_key($attrsOf, $expected))->toBe($expected);
})->with([
    'a start that is text' => ['orderedList', ['start' => '2'], ['start' => 1]],
    'a start that is no number (NaN as JSON)' => ['orderedList', ['start' => null], ['start' => 1]],
    'a start that is NaN' => ['orderedList', ['start' => NAN], ['start' => 1]],
    'a start that is a fraction' => ['orderedList', ['start' => 2.5], ['start' => 1]],
    'a start below zero' => ['orderedList', ['start' => -3], ['start' => 1]],
    'a start beyond nine digits' => ['orderedList', ['start' => 1_000_000_000], ['start' => 1]],
    'the largest start' => ['orderedList', ['start' => Schema::LIST_START_MAX], ['start' => Schema::LIST_START_MAX]],
    'a colspan of zero' => ['tableCell', ['colspan' => 0], ['colspan' => 1]],
    'a colspan that is a fraction' => ['tableCell', ['colspan' => 2.5], ['colspan' => 1]],
    'a colspan that is text' => ['tableHeader', ['colspan' => 'x'], ['colspan' => 1]],
    'a rowspan of zero' => ['tableCell', ['rowspan' => 0], ['rowspan' => 1]],
    'a rowspan that is text' => ['tableCell', ['rowspan' => 'x'], ['rowspan' => 1]],
    'widths with NaN (null as JSON)' => ['tableCell', ['colwidth' => [null]], ['colwidth' => null]],
    'widths with NaN' => ['tableCell', ['colwidth' => [NAN]], ['colwidth' => null]],
    'widths of zero' => ['tableCell', ['colwidth' => [0]], ['colwidth' => null]],
    'widths below zero' => ['tableHeader', ['colwidth' => [120, -5]], ['colwidth' => null]],
    'widths that are text' => ['tableHeader', ['colwidth' => ['100']], ['colwidth' => null]],
    'widths that are no list' => ['tableHeader', ['colwidth' => ['a' => 100]], ['colwidth' => null]],
    'a language with a backtick' => ['codeBlock', ['language' => 'php`'], ['language' => null]],
    'a language with a line break' => ['codeBlock', ['language' => "php\n"], ['language' => null]],
    'a language of a class name' => ['codeBlock', ['language' => 'language-php hljs'], ['language' => null]],
    'a language longer than 32' => ['codeBlock', ['language' => str_repeat('a', 33)], ['language' => null]],
    'a language that is a number' => ['codeBlock', ['language' => 5], ['language' => null]],
]);

it('keeps refusing a heading level beyond three, an unknown node and an unknown mark', function () use ($reason) {
    expect($reason(F::doc(['type' => 'heading', 'attrs' => ['level' => 0], 'content' => [F::text('x')]])))->toBe('shape')
        ->and($reason(F::doc(['type' => 'heading', 'attrs' => ['level' => '2'], 'content' => [F::text('x')]])))->toBe('shape')
        ->and($reason(F::doc(['type' => 'iframe'])))->toBe('node')
        ->and($reason(F::doc(F::p(['type' => 'text', 'text' => 'x', 'marks' => [['type' => 'underline']]]))))->toBe('mark');
});

it('takes the attributes of every kind it knows', function () {
    $json = F::doc(
        ['type' => 'codeBlock', 'attrs' => ['language' => 'c++'], 'content' => [F::text('int a;')]],
        ['type' => 'table', 'content' => [['type' => 'tableRow', 'content' => [
            ['type' => 'tableHeader', 'attrs' => ['colspan' => 2, 'rowspan' => 1, 'colwidth' => [120, 80], 'align' => 'center'], 'content' => [F::p('x')]],
        ]]]],
        ['type' => 'orderedList', 'attrs' => ['start' => 0, 'type' => 'a'], 'content' => [['type' => 'listItem', 'content' => [F::p('x')]]]],
    );

    expect(Document::fromJson($json)->toJson())->toBe($json);
});

it('refuses deep nesting', function () use ($reason, $nested) {
    // the paragraph's text is at 32 below the doc, one blockquote more puts it at 33
    expect($reason($nested(Schema::MAX_DEPTH - 2)))->toBeNull()
        ->and($reason($nested(Schema::MAX_DEPTH - 1)))->toBe('depth')
        ->and($reason($nested(33)))->toBe('depth');
});

it('refuses more than 256 KB', function () use ($reason) {
    // the bytes of the compact JSON in UTF-8 count, not the characters
    $around = strlen((string) json_encode(F::doc(F::p('x')))) - 1;

    expect($reason(F::doc(F::p(str_repeat('x', Schema::MAX_BYTES - $around)))))->toBeNull()
        ->and($reason(F::doc(F::p(str_repeat('x', Schema::MAX_BYTES - $around + 1)))))->toBe('size')
        ->and($reason(F::doc(F::p(str_repeat('ä', intdiv(Schema::MAX_BYTES - $around, 2) + 1)))))->toBe('size');
});

it('drops a javascript link but keeps the text', function () {
    $linked = fn (string $href) => F::doc(F::p(['type' => 'text', 'marks' => [['type' => 'link', 'attrs' => F::link($href)], ['type' => 'bold']], 'text' => 'klick']));

    expect(Document::fromJson($linked('javascript:alert(1)'))->toJson())->toBe(F::doc(F::p(F::text('klick', 'bold'))))
        ->and(Document::fromJson($linked(' https://example.com'))->toJson())->toBe(F::doc(F::p(F::text('klick', 'bold'))))
        ->and(Document::fromJson($linked('/relative'))->toJson())->toBe(F::doc(F::p(F::text('klick', 'bold'))))
        ->and(Document::fromJson(F::doc(F::p(['type' => 'text', 'marks' => [['type' => 'link']], 'text' => 'ohne'])))->toJson())->toBe(F::doc(F::p('ohne')))
        ->and(Document::fromJson($linked('HTTPS://example.com'))->toJson())->toBe($linked('HTTPS://example.com'))
        ->and(Document::fromJson($linked('http://example.com'))->toJson())->toBe($linked('http://example.com'))
        ->and(Document::fromJson($linked('mailto:mara@example.com'))->toJson())->toBe($linked('mailto:mara@example.com'));
});

it('keeps the editor\'s class, rel and target on every link, whatever the input says', function () {
    $hostile = ['href' => 'https://example.com', 'target' => '_self', 'rel' => 'opener', 'class' => 'fixed inset-0 z-50 opacity-0', 'title' => 'Doku'];
    $json = Document::fromJson(F::doc(F::p(['type' => 'text', 'marks' => [['type' => 'link', 'attrs' => $hostile]], 'text' => 'klick'])))->toJson();

    expect($json['content'][0]['content'][0]['marks'][0]['attrs'])->toBe(array_replace(F::link('https://example.com'), ['title' => 'Doku']))
        ->and(Document::fromJson(F::doc(F::p(['type' => 'text', 'marks' => [['type' => 'link', 'attrs' => ['href' => 'https://example.com', 'class' => ['x']]]], 'text' => 'klick'])))->toHtml())
        ->toBe('<p><a target="_blank" rel="noopener noreferrer nofollow" href="https://example.com">klick</a></p>');
});

it('writes plain text block by block', function () {
    expect(Document::fromJson(F::web47Steps())->toText())->toBe(implode("\n", [
        'So lässt sich der Fehler nachstellen:',
        'Die Formularseite in Safari (iOS 18) öffnen.',
        'Alle Felder ausfüllen und auf „Absenden“ tippen.',
        'Im Postfach des Teams liegen zwei identische Mails.',
    ]))->and(Document::fromJson(F::everyNode())->toText())->toBe(implode("\n", [
        'Doppelte Mails',
        'Das Formular muss einmal senden, zweimal ist falsch: submit().',
        'Mehr unter Doku.',
        'Safari',
        'Firefox',
        'Version 130',
        'Öffnen',
        'Absenden',
        'Fehler nachgestellt',
        'Fix geprüft',
        'Zwei Mails im Postfach.',
        '$form->submit();',
        '$form->submit();',
        'Browser',
        'Mails',
        'Safari',
        '2',
    ]))->and(Document::fromJson(F::doc(F::p(), F::p(' '), F::p('a')))->toText())->toBe('a');
});

it('knows an empty document', function () {
    expect(Document::fromJson(F::doc(['type' => 'paragraph']))->isEmpty())->toBeTrue()
        ->and(Document::fromJson(['type' => 'doc'])->isEmpty())->toBeTrue()
        ->and(Document::fromJson(F::doc(F::p('  '), ['type' => 'bulletList', 'content' => [['type' => 'listItem', 'content' => [F::p()]]]]))->isEmpty())->toBeTrue()
        ->and(Document::fromJson(F::doc(F::p(), F::p('a')))->isEmpty())->toBeFalse()
        ->and(Document::fromJson(F::doc(['type' => 'horizontalRule']))->isEmpty())->toBeFalse()
        ->and(Document::fromJson(F::doc(['type' => 'table', 'content' => [['type' => 'tableRow', 'content' => [['type' => 'tableCell', 'content' => [F::p()]]]]]]))->isEmpty())->toBeFalse();
});

it('renders HTML from the nodes, never from text', function () {
    $html = Document::fromJson(F::doc(
        F::p('<script>alert(1)</script> & ', ['type' => 'text', 'marks' => [['type' => 'link', 'attrs' => F::link('https://example.com/?a=1&b=2')]], 'text' => 'Doku']),
        ['type' => 'taskList', 'content' => [['type' => 'taskItem', 'attrs' => ['checked' => true], 'content' => [F::p('fertig')]]]],
    ))->toHtml();

    expect($html)->toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; <a target="_blank" rel="noopener noreferrer nofollow" href="https://example.com/?a=1&amp;b=2">Doku</a></p>'
        .'<ul data-type="taskList"><li data-checked="true" data-type="taskItem"><label><input type="checkbox" checked="checked"><span></span></label><div><p>fertig</p></div></li></ul>');
});
