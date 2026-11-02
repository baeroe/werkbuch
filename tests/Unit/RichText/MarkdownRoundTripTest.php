<?php

use App\RichText\Document;
use App\RichText\InvalidDocument;
use App\RichText\MarkdownContext;
use App\RichText\Schema;
use Tests\Support\RichTextFixtures as F;

$read = fn (string $markdown): Document => Document::fromMarkdown($markdown, new MarkdownContext);

it('writes Markdown it reads as it was', function (string $markdown) use ($read) {
    expect($read($markdown)->toMarkdown())->toBe($markdown);
})->with([
    'heading 1' => ['# Titel'],
    'heading 2' => ['## Titel'],
    'heading 3' => ['### Titel'],
    'marks' => ['**fett** *kursiv* ~~weg~~ `code`'],
    'link' => ['[Link](https://example.com)'],
    'nested list' => ["- a\n  - b"],
    'nested list below a mark' => ["- *a*\n  - b"],
    'numbered list' => ["1. eins\n2. zwei"],
    'numbered list from three' => ["3. drei\n4. vier"],
    'numbers around a nested list' => ["1. a\n   - b\n   - c\n2. d"],
    'task list' => ["- [x] erledigt\n- [ ] offen"],
    'task with marks' => ['- [ ] **fett**'],
    'quote' => ['> Zitat'],
    'quote in a list' => ['- > Zitat'],
    'code' => ["```php\n\$a = 1;\necho \$a;\n```"],
    'code without language' => ["```\nzwei\n\nAbsätze\n```"],
    'table' => ["| a | b |\n| --- | --- |\n| 1 | 2 |"],
    'table with empty cells' => ["| a |  |\n| --- | --- |\n|  | 2 |"],
    'hard break' => ["zeile  \nzwei"],
    'rule' => ['---'],
    'blocks of an item' => ["- a\n\n  zwei\n- b"],
    'empty item' => ["-\n- b"],
    'ampersand and an escaped entity' => ['Tom & Jerry \&lt; ~~weg~~'],
    'code in a list item' => ["- a\n\n  ```php\n  x\n  ```"],
    'code in a quote' => ["> ```js\n> x\n> ```"],
    'code after text in a quote' => ["> a\n>\n> ```\n> x\n> ```"],
    'nothing' => [''],
]);

it('writes one form of everything it reads', function (string $markdown, string $written) use ($read) {
    expect($read($markdown)->toMarkdown())->toBe($written)
        ->and($read($written)->toJson())->toBe($read($markdown)->toJson());
})->with([
    'list marker' => ['* a', '- a'],
    'lists of one kind in a row' => ["- a\n\n* b\n\n- c\n\n1. d\n\n1) e", "- a\n\n* b\n\n- c\n\n1. d\n\n1) e"],
    'a task list right after a list' => ["- a\n\n* [ ] b", "- a\n\n* [ ] b"],
    'setext heading' => ["Titel\n=====", '# Titel'],
    'emphasis with underscores' => ['__fett__ _kursiv_', '**fett** *kursiv*'],
    'soft line break' => ["a\nb", 'a b'],
    'heading below level 3' => ['#### Vier', 'Vier'],
    'tilde fence' => ["~~~js\nx\n~~~", "```js\nx\n```"],
    'fence with an info string no language' => ["```{r}\nx\n```", "```\nx\n```"],
    'fence with a language longer than 32' => ['```'.str_repeat('a', 33)."\nx\n```", "```\nx\n```"],
    'bare address' => ['https://example.com/?a=1&b=2', '<https://example.com/?a=1&b=2>'],
    'loose task list' => ["- [x] a\n\n- [ ] b", "- [x] a\n- [ ] b"],
    'checkbox in a mixed list' => ["- [x] a\n- b", "- \\[x\\] a\n- b"],
    'checkbox in a numbered list' => ['1. [ ] a', '1. \\[ \\] a'],
    'link to an address werkbuch does not link' => ['[x](ftp://example.com) [y](javascript:alert(1))', 'x y'],
]);

it('reads every node from Markdown as the editor would send it', function () use ($read) {
    $markdown = implode("\n", [
        '## Doppelte Mails',
        '',
        'Das Formular **muss** *einmal* senden, ~~zweimal~~ ist falsch: `submit()`.  ',
        'Mehr unter [Doku](https://example.com).',
        '',
        '- Safari',
        '- Firefox',
        '  1. Version 130',
        '',
        '3. Öffnen',
        '4. Absenden',
        '',
        '- [x] Fehler nachgestellt',
        '- [ ] Fix geprüft',
        '',
        '> Zwei Mails im Postfach.',
        '',
        '```php',
        '$form->submit();',
        '$form->submit();',
        '```',
        '',
        '---',
        '',
        '| Browser | Mails |',
        '| --- | --- |',
        '| Safari | 2 |',
    ]);

    expect($read($markdown)->toJson())->toBe(F::everyNode())
        ->and(Document::fromJson(F::everyNode())->toMarkdown())->toBe($markdown);
});

it('comes back the same from its Markdown', function (array $json) use ($read) {
    expect($read(Document::fromJson($json)->toMarkdown())->toJson())->toBe($json);
})->with([
    'steps of WEB-47' => [F::web47Steps()],
    'every node' => [F::everyNode()],
    'markdown characters in text' => [F::doc(F::p('a ~~b~~ *c* [d] # e <f> & g &amp; \\h'), F::p('- kein Punkt'), F::p('1. keine Zahl'))],
    'code in a list item and in a quote' => [F::doc(
        ['type' => 'bulletList', 'content' => [['type' => 'listItem', 'content' => [F::p('Ausführen:'), ['type' => 'codeBlock', 'attrs' => ['language' => 'bash'], 'content' => [F::text("ddev start\nddev artisan migrate")]]]]]],
        ['type' => 'blockquote', 'content' => [F::p('Fehler:'), ['type' => 'codeBlock', 'attrs' => ['language' => null], 'content' => [F::text('500')]]]],
    )],
    'lists of one kind in a row' => [F::doc(
        ['type' => 'bulletList', 'content' => [['type' => 'listItem', 'content' => [F::p('a')]]]],
        ['type' => 'taskList', 'content' => [['type' => 'taskItem', 'attrs' => ['checked' => false], 'content' => [F::p('b')]]]],
        ['type' => 'bulletList', 'content' => [['type' => 'listItem', 'content' => [F::p('c')]]]],
        ['type' => 'orderedList', 'attrs' => ['start' => 1, 'type' => null], 'content' => [['type' => 'listItem', 'content' => [F::p('d'), ['type' => 'orderedList', 'attrs' => ['start' => 1, 'type' => null], 'content' => [['type' => 'listItem', 'content' => [F::p('e')]]]]]]]],
        ['type' => 'orderedList', 'attrs' => ['start' => 5, 'type' => null], 'content' => [['type' => 'listItem', 'content' => [F::p('f')]]]],
    )],
]);

it('reads its own Markdown back to the same JSON', function () use ($read) {
    // marks as the editor orders them, and one text node for each run of the same marks
    $marked = fn (string $text, array ...$marks) => ['type' => 'text', 'marks' => $marks, 'text' => $text];
    $link = ['type' => 'link', 'attrs' => F::link('https://example.com')];
    $json = F::everyNode();
    $json['content'][] = F::p($marked('fetter Link', $link, ['type' => 'bold']), F::text(' und '), $marked('beides', ['type' => 'bold'], ['type' => 'italic']));

    expect($read(Document::fromJson($json)->toMarkdown())->toJson())->toBe($json)
        ->and($read('***[fetter Link](https://example.com)*** a & b')->toJson())
        ->toBe(F::doc(F::p($marked('fetter Link', $link, ['type' => 'bold'], ['type' => 'italic']), F::text(' a & b'))));
});

it('reads a list item that starts with a list, a heading or a code block', function (string $markdown, array $first) use ($read) {
    // the editor's list item starts with a paragraph (`paragraph block*`), so an empty one goes first
    $document = $read($markdown);
    $item = $document->toJson()['content'][0]['content'][0];

    expect($item['content'][0])->toBe(['type' => 'paragraph'])
        ->and($item['content'][1])->toBe($first)
        ->and($read($document->toMarkdown())->toJson())->toBe($document->toJson())
        ->and($read($read($document->toMarkdown())->toMarkdown())->toMarkdown())->toBe($document->toMarkdown());
})->with([
    'a list' => ['- - a', ['type' => 'bulletList', 'content' => [['type' => 'listItem', 'content' => [F::p('a')]]]]],
    'a numbered list in a numbered list' => ['1. 1. a', ['type' => 'orderedList', 'attrs' => ['start' => 1, 'type' => null], 'content' => [['type' => 'listItem', 'content' => [F::p('a')]]]]],
    'a heading' => ['- # Titel', ['type' => 'heading', 'attrs' => ['level' => 1], 'content' => [F::text('Titel')]]],
    'a code block' => ['- ```php
  x
  ```', ['type' => 'codeBlock', 'attrs' => ['language' => 'php'], 'content' => [F::text('x')]]],
    'a rule' => ['- ***', ['type' => 'horizontalRule']],
    'a quote' => ['- > Zitat', ['type' => 'blockquote', 'content' => [F::p('Zitat')]]],
]);

it('writes a rule that starts an item so that it stays in the item', function () use ($read) {
    $item = fn (array ...$blocks) => ['type' => 'bulletList', 'content' => [['type' => 'listItem', 'content' => $blocks]]];
    $rule = [['type' => 'paragraph'], ['type' => 'horizontalRule']];
    $json = F::doc($item(...$rule), $item(F::p('a')), $item(...$rule));

    // `- ---` would be a rule of its own, `* ***` too
    expect(Document::fromJson($json)->toMarkdown())->toBe("- ***\n\n* a\n\n- ***")
        ->and($read(Document::fromJson($json)->toMarkdown())->toJson())->toBe($json)
        ->and(Document::fromJson(F::doc($item(F::p('a')), $item(...$rule)))->toMarkdown())->toBe("- a\n\n* ---");
});

it('loses the block of a task item whose first paragraph is empty to its text', function () use ($read) {
    // GitHub's checkbox needs a paragraph to stand in
    $json = F::doc(['type' => 'taskList', 'content' => [['type' => 'taskItem', 'attrs' => ['checked' => false], 'content' => [
        F::p(), ['type' => 'bulletList', 'content' => [['type' => 'listItem', 'content' => [F::p('a')]]]],
    ]]]]);

    expect($read(Document::fromJson($json)->toMarkdown())->toJson())
        ->toBe(F::doc(['type' => 'taskList', 'content' => [['type' => 'taskItem', 'attrs' => ['checked' => false], 'content' => [F::p('- a')]]]]));
});

it('writes the spaces at the edges of a strike outside of it', function () {
    $document = Document::fromJson(F::doc(
        F::p(F::text('a'), F::text(' weg ', 'strike'), F::text('b')),
        F::p(F::text('c'), F::text(' ', 'strike'), F::text('d')),
    ));

    expect($document->toMarkdown())->toBe("a ~~weg~~ b\n\nc d");
});

it('leaves images out until Phase 7 brings them', function () use ($read) {
    $document = $read('![Logo](https://example.com/logo.png)');

    expect($document->isEmpty())->toBeTrue()
        ->and($document->toMarkdown())->toBe('');
});

it('refuses Markdown that would take long or crash before it is parsed', function (string $markdown, string $reason) use ($read) {
    $started = microtime(true);
    try {
        $read($markdown);
        $refused = null;
    } catch (InvalidDocument $invalid) {
        $refused = $invalid->reason;
    }

    // without the limits: 10 s for the quotes, 25 s for the code spans, a crash for nesting deeper still
    expect($refused)->toBe($reason)
        ->and(microtime(true) - $started)->toBeLessThan(3.0);
})->with([
    'one byte too long' => [str_repeat('\\*', intdiv(Schema::MAX_BYTES, 2)).'x', 'size'],
    'quotes 10,000 deep' => [str_repeat('>', 10000).' tief', 'depth'],
    'lists nested on one line up to the limit' => [str_repeat('- ', intdiv(Schema::MAX_BYTES, 2) - 1).'x', 'depth'],
    'lists nested by indentation up to the limit' => [(function () {
        $markdown = '';
        for ($level = 0; strlen($markdown) < Schema::MAX_BYTES - 2000; $level++) {
            $markdown .= str_repeat('  ', $level)."- a\n";
        }

        return $markdown;
    })(), 'depth'],
    'a run of stars nesting a thousand marks' => [str_repeat('*', 2000).'a'.str_repeat('*', 2000), 'depth'],
    'code spans up to the limit' => [str_repeat('`a` ', intdiv(Schema::MAX_BYTES, 4)), 'size'],
    'a text that is no UTF-8' => ["a\xffb", 'shape'],
]);

it('reads Markdown at the limits that a document can hold', function () use ($read) {
    // as many nodes as a document just below MAX_BYTES holds, and marks inside blocks nested as deep as they may be
    $words = Document::fromJson(F::doc(F::p(...array_merge(...array_fill(0, 3200, [F::text('a', 'bold'), F::text(' b')])))));
    $deep = $read(str_repeat('> ', Schema::MAX_DEPTH - 2).'***[a](https://example.com)***');

    expect(strlen((string) json_encode($words->toJson())))->toBeGreaterThan(Schema::MAX_BYTES - 10000)
        ->and($read($words->toMarkdown())->toJson())->toBe($words->toJson())
        ->and($deep->toText())->toBe('a');
});

it('keeps HTML in Markdown as text', function () use ($read) {
    $document = $read("<script>alert(1)</script>\n\nText <b>fett</b>");

    expect($document->toJson())->toBe(F::doc(F::p('<script>alert(1)</script>'), F::p('Text <b>fett</b>')))
        ->and($document->toHtml())->toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p><p>Text &lt;b&gt;fett&lt;/b&gt;</p>')
        ->and($document->toMarkdown())->toBe("\\<script\\>alert(1)\\</script\\>\n\nText \\<b\\>fett\\</b\\>");
});
