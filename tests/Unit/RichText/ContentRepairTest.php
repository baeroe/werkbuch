<?php

use App\RichText\ContentRepair;
use App\RichText\Document;
use App\RichText\InvalidDocument;
use Tests\Support\RichTextFixtures as F;

/*
 * Documents stored before Document checked Schema::CONTENT (Phase 4 to 6): what the reading of Markdown and the REST
 * JSON left then, filled the way ProseMirror fills content it reads.
 */

$item = fn (array ...$blocks) => ['type' => 'listItem', 'content' => $blocks];
$bullets = fn (array ...$items) => ['type' => 'bulletList', 'content' => $items];
$paragraph = ['type' => 'paragraph'];

it('puts an empty paragraph before a list item or task item that starts with another block', function () use ($item, $bullets, $paragraph) {
    $heading = ['type' => 'heading', 'attrs' => ['level' => 1], 'content' => [F::text('Titel')]];
    $task = fn (array ...$blocks) => ['type' => 'taskItem', 'attrs' => ['checked' => true], 'content' => $blocks];

    expect(ContentRepair::of(F::doc($bullets($item($bullets($item(F::p('a'))))), $bullets($item($heading)))))
        ->toBe(F::doc($bullets($item($paragraph, $bullets($item(F::p('a'))))), $bullets($item($paragraph, $heading))))
        ->and(ContentRepair::of(F::doc(['type' => 'taskList', 'content' => [$task(['type' => 'horizontalRule']), $task()]])))
        ->toBe(F::doc(['type' => 'taskList', 'content' => [$task($paragraph, ['type' => 'horizontalRule']), $task($paragraph)]]));
});

it('gives an empty quote and an empty cell a paragraph', function () use ($paragraph) {
    $cell = fn (string $type, array ...$blocks) => ['type' => $type, 'attrs' => ['colspan' => 1, 'rowspan' => 1, 'colwidth' => null, 'align' => null], 'content' => $blocks];
    $table = fn (array ...$cells) => ['type' => 'table', 'content' => [['type' => 'tableRow', 'content' => $cells]]];

    expect(ContentRepair::of(F::doc(['type' => 'blockquote'], $table($cell('tableHeader'), $cell('tableCell')))))
        ->toBe(F::doc(['type' => 'blockquote', 'content' => [$paragraph]], $table($cell('tableHeader', $paragraph), $cell('tableCell', $paragraph))));
});

it('drops an empty list and an empty table, and fills what they leave empty', function () use ($item, $bullets, $paragraph) {
    expect(ContentRepair::of(F::doc(
        ['type' => 'bulletList', 'content' => []],
        ['type' => 'orderedList', 'attrs' => ['start' => 1, 'type' => null]],
        ['type' => 'taskList'],
        ['type' => 'table', 'content' => []],
        ['type' => 'blockquote', 'content' => [['type' => 'bulletList']]],
        $bullets($item(['type' => 'orderedList', 'attrs' => ['start' => 1, 'type' => null], 'content' => []])),
        F::p('bleibt'),
    )))->toBe(F::doc(
        ['type' => 'blockquote', 'content' => [$paragraph]],
        $bullets($item($paragraph)),
        F::p('bleibt'),
    ))->and(ContentRepair::of(F::doc(['type' => 'bulletList'])))->toBe(['type' => 'doc', 'content' => []]);
});

it('leaves a document that fits as it is', function () {
    expect(ContentRepair::of(F::everyNode()))->toBe(F::everyNode())
        ->and(ContentRepair::of(F::web47Steps()))->toBe(F::web47Steps())
        ->and(ContentRepair::of(['type' => 'doc']))->toBe(['type' => 'doc'])
        // what it does not understand stays for Document to refuse
        ->and(ContentRepair::of(['type' => 'doc', 'content' => 'x']))->toBe(['type' => 'doc', 'content' => 'x'])
        ->and(ContentRepair::of(F::doc(['type' => 'listItem', 'content' => ['x']])))->toBe(F::doc(['type' => 'listItem', 'content' => [['type' => 'paragraph'], 'x']]));
});

it('makes every stored form of Phase 4 to 6 readable', function (array $stored) {
    expect(fn () => Document::fromJson($stored))->toThrow(InvalidDocument::class);

    $read = Document::fromJson(ContentRepair::of($stored));

    expect($read->toJson()['type'])->toBe('doc')
        ->and(Document::fromJson($read->toJson())->toJson())->toBe($read->toJson());
})->with([
    // what `- - a`, `- # Titel`, `- ***`, `- > x` and a fence at the start of an item read as before
    'a list in a list item' => [F::doc(['type' => 'bulletList', 'content' => [['type' => 'listItem', 'content' => [['type' => 'bulletList', 'content' => [['type' => 'listItem', 'content' => [F::p('a')]]]]]]]])],
    'a rule in a list item' => [F::doc(['type' => 'bulletList', 'content' => [['type' => 'listItem', 'content' => [['type' => 'horizontalRule']]]]])],
    'a code block in a list item' => [F::doc(['type' => 'orderedList', 'attrs' => ['start' => 1, 'type' => null], 'content' => [['type' => 'listItem', 'content' => [['type' => 'codeBlock', 'attrs' => ['language' => null], 'content' => [F::text('x')]]]]]])],
    'an empty quote in a cell' => [F::doc(['type' => 'table', 'content' => [['type' => 'tableRow', 'content' => [['type' => 'tableCell', 'content' => [['type' => 'blockquote']]]]]]])],
    'an empty list in a quote' => [F::doc(['type' => 'blockquote', 'content' => [['type' => 'taskList', 'content' => []]]])],
]);
