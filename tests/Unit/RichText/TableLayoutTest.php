<?php

use App\RichText\Document;
use App\RichText\MarkdownContext;
use App\RichText\TableLayout;
use Tests\Support\RichTextFixtures as F;

/*
 * Markdown knows one table: the first row is the header, no column is (A455). A text read from Markdown takes the
 * header row and the header column of the table it had before, so a client writing back what it read loses neither.
 */

/** A table of texts: the first row header cells with `$row`, the first cell of every row with `$column`. */
$grid = function (bool $row, bool $column, array ...$rows): array {
    $table = [];
    foreach (array_values($rows) as $r => $texts) {
        $cells = [];
        foreach (array_values($texts) as $c => $text) {
            $cells[] = F::cell(($r === 0 && $row) || ($c === 0 && $column) ? 'tableHeader' : 'tableCell', $text);
        }
        $table[] = $cells;
    }

    return F::table(...$table);
};

$read = fn (string $markdown, ?array $before = null): array => Document::fromMarkdown(
    $markdown,
    new MarkdownContext(before: $before === null ? null : Document::fromJson($before)),
)->toJson();

it('tells the header row and the header column of a table', function (array $table, bool $row, bool $column) {
    expect(TableLayout::of($table))->toBe(['header_row' => $row, 'header_column' => $column]);
})->with([
    'header row' => [F::table([F::cell('tableHeader', 'a'), F::cell('tableHeader', 'b')], [F::cell('tableCell', 'c'), F::cell('tableCell', 'd')]), true, false],
    'header column' => [F::table([F::cell('tableHeader', 'a'), F::cell('tableCell', 'b')], [F::cell('tableHeader', 'c'), F::cell('tableCell', 'd')]), false, true],
    'both' => [F::table([F::cell('tableHeader', 'a'), F::cell('tableHeader', 'b')], [F::cell('tableHeader', 'c'), F::cell('tableCell', 'd')]), true, true],
    'neither' => [F::table([F::cell('tableCell', 'a'), F::cell('tableCell', 'b')], [F::cell('tableCell', 'c'), F::cell('tableCell', 'd')]), false, false],
    'a header cell in the first row only' => [F::table([F::cell('tableHeader', 'a'), F::cell('tableCell', 'b')], [F::cell('tableCell', 'c'), F::cell('tableCell', 'd')]), false, false],
    'one row of header cells' => [F::table([F::cell('tableHeader', 'a'), F::cell('tableHeader', 'b')]), true, false],
    'an empty first row' => [['type' => 'table', 'content' => [['type' => 'tableRow']]], false, false],
]);

it('keeps a header column through Markdown', function () use ($grid, $read) {
    $before = F::doc($grid(true, true, ['Browser', 'Mails'], ['Safari', '2'], ['Chrome', '1']));
    $markdown = str_replace('| Chrome | 1 |', '| Chrome | 0 |', Document::fromJson($before)->toMarkdown());

    expect($read($markdown, $before))->toBe(F::doc($grid(true, true, ['Browser', 'Mails'], ['Safari', '2'], ['Chrome', '0'])))
        // without the text before it is Markdown's own table
        ->and($read($markdown))->toBe(F::doc($grid(true, false, ['Browser', 'Mails'], ['Safari', '2'], ['Chrome', '0'])));
});

it('keeps a table without a header row through Markdown', function () use ($grid, $read) {
    $before = F::doc($grid(false, false, ['a', 'b'], ['c', 'd']));
    $markdown = Document::fromJson($before)->toMarkdown();

    expect($markdown)->toBe("| a | b |\n| --- | --- |\n| c | d |")
        ->and($read($markdown, $before))->toBe($before)
        ->and($read($markdown))->toBe(F::doc($grid(true, false, ['a', 'b'], ['c', 'd'])));
});

it('keeps a header column without a header row through Markdown', function () use ($grid, $read) {
    $before = F::doc($grid(false, true, ['Safari', '2'], ['Chrome', '1']));

    expect(TableLayout::of($before['content'][0]))->toBe(['header_row' => false, 'header_column' => true])
        ->and($read(Document::fromJson($before)->toMarkdown(), $before))->toBe($before);
});

it('keeps the layout when Markdown adds a row', function () use ($grid, $read) {
    $before = F::doc($grid(false, true, ['Safari', '2'], ['Chrome', '1']));
    $markdown = Document::fromJson($before)->toMarkdown()."\n| Firefox | 0 |";

    expect($read($markdown, $before))->toBe(F::doc($grid(false, true, ['Safari', '2'], ['Chrome', '1'], ['Firefox', '0'])));
});

it('takes the Markdown form when the columns changed', function () use ($grid, $read) {
    $before = F::doc($grid(false, true, ['Safari', '2'], ['Chrome', '1']));
    $markdown = "| Safari | 2 | iOS |\n| --- | --- | --- |\n| Chrome | 1 | Android |";

    expect($read($markdown, $before))->toBe(F::doc($grid(true, false, ['Safari', '2', 'iOS'], ['Chrome', '1', 'Android'])));
});

it('matches tables by their order', function () use ($grid, $read) {
    $before = F::doc(
        $grid(true, true, ['Browser', 'x'], ['a', '1']),
        F::p('dazwischen'),
        $grid(false, false, ['b', '2'], ['c', '3']),
    );
    // a third table has none before it: Markdown's form
    $markdown = Document::fromJson($before)->toMarkdown()."\n\n| d | 4 |\n| --- | --- |\n| e | 5 |";

    expect($read($markdown, $before))->toBe(F::doc(
        $grid(true, true, ['Browser', 'x'], ['a', '1']),
        F::p('dazwischen'),
        $grid(false, false, ['b', '2'], ['c', '3']),
        $grid(true, false, ['d', '4'], ['e', '5']),
    ));
});

it('takes no layout from another table when one is inserted before it', function () use ($grid, $read) {
    $before = F::doc(
        $grid(true, true, ['Browser', 'Mails'], ['Safari', '2']),
        $grid(false, false, ['b', '2'], ['c', '3']),
    );
    // a new table of as many columns in front: it must not take the header column of the table that was first
    $markdown = "| Neu | x |\n| --- | --- |\n| n | 1 |\n\n".Document::fromJson($before)->toMarkdown();

    expect($read($markdown, $before))->toBe(F::doc(
        $grid(true, false, ['Neu', 'x'], ['n', '1']),
        $grid(true, true, ['Browser', 'Mails'], ['Safari', '2']),
        $grid(false, false, ['b', '2'], ['c', '3']),
    ));
});

it('takes no layout from another table when one in the middle is removed', function () use ($grid, $read) {
    $first = $grid(true, true, ['Browser', 'Mails'], ['Safari', '2']);
    $last = $grid(false, false, ['b', '2'], ['c', '3']);
    $before = F::doc($first, $grid(false, true, ['Mitte', 'm'], ['z', '9']), $last);
    $markdown = Document::fromJson(F::doc($first, $last))->toMarkdown();

    expect($read($markdown, $before))->toBe(F::doc($first, $last));
});

it('pairs a table by the text of its first row, whatever its marks and spaces', function () use ($read) {
    // Markdown reads two spaces as one: the first rows still count as the same text
    $first = fn (string $space) => F::table(
        [['type' => 'tableHeader', 'attrs' => F::cell('tableHeader', '')['attrs'], 'content' => [F::p(F::text('Brow', 'bold'), 'ser'.$space, F::text('neu', 'italic'))]], F::cell('tableHeader', 'Mails')],
        [F::cell('tableHeader', 'Safari'), F::cell('tableCell', '2')],
    );
    $added = F::table([F::cell('tableHeader', 'd'), F::cell('tableHeader', '4')], [F::cell('tableCell', 'e'), F::cell('tableCell', '5')]);

    expect($read(Document::fromJson(F::doc($first('  '), $added))->toMarkdown(), F::doc($first('  '))))->toBe(F::doc($first(' '), $added));
});

it('takes the Markdown form for a table between the matched ones', function () use ($grid, $read) {
    // one table added and the first row of the other changed: neither pairs up, both read as Markdown writes them
    $before = F::doc($grid(false, true, ['Safari', '2'], ['Chrome', '1']));
    $markdown = "| Safari | 3 |\n| --- | --- |\n| Chrome | 1 |\n\n| Neu | x |\n| --- | --- |\n| n | 1 |";

    expect($read($markdown, $before))->toBe(F::doc(
        $grid(true, false, ['Safari', '3'], ['Chrome', '1']),
        $grid(true, false, ['Neu', 'x'], ['n', '1']),
    ));
});

it('counts no table inside a cell of the text before', function () use ($grid, $read) {
    $inner = $grid(false, false, ['x']);
    $outer = F::table(
        [F::cell('tableCell', 'a'), F::cell('tableCell', 'b')],
        [['type' => 'tableCell', 'attrs' => ['colspan' => 1, 'rowspan' => 1, 'colwidth' => null, 'align' => null], 'content' => [$inner]], F::cell('tableCell', 'c')],
    );
    $before = F::doc($outer, $grid(false, true, ['d', '4'], ['e', '5']));

    expect($read("| a | b |\n| --- | --- |\n| x | c |\n\n| d | 4 |\n| --- | --- |\n| e | 5 |", $before))->toBe(F::doc(
        $grid(false, false, ['a', 'b'], ['x', 'c']),
        $grid(false, true, ['d', '4'], ['e', '5']),
    ));
});

it('never brings back single header cells or spans', function () use ($read) {
    // a cell over two rows and a header cell in the last row: neither a header row nor a header column
    $before = F::doc(F::table(
        [F::cell('tableCell', 'a', ['rowspan' => 2, 'colwidth' => [120]]), F::cell('tableCell', 'b')],
        [F::cell('tableCell', 'd')],
        [F::cell('tableCell', 'e'), F::cell('tableHeader', 'f')],
    ));
    $markdown = Document::fromJson($before)->toMarkdown();
    $empty = ['type' => 'tableCell', 'attrs' => ['colspan' => 1, 'rowspan' => 1, 'colwidth' => null, 'align' => null], 'content' => [['type' => 'paragraph']]];

    expect($markdown)->toBe("| a | b |\n| --- | --- |\n| d |\n| e | f |")
        ->and($read($markdown, $before))->toBe(F::doc(F::table(
            [F::cell('tableCell', 'a'), F::cell('tableCell', 'b')],
            [F::cell('tableCell', 'd'), $empty],
            [F::cell('tableCell', 'e'), F::cell('tableCell', 'f')],
        )));
});

it('leaves a text without tables and one without a text before as read', function () use ($read) {
    $text = F::doc(F::p('Nur Text'));
    $read = Document::fromJson($text);

    expect(TableLayout::keep($read, null))->toBe($read)
        ->and(TableLayout::keep($read, Document::fromJson(F::doc(F::table([F::cell('tableCell', 'a')])))))->toBe($read);

    $table = Document::fromJson(F::doc(F::table([F::cell('tableHeader', 'a')])));
    expect(TableLayout::keep($table, $read))->toBe($table);
});
