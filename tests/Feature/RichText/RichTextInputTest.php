<?php

use App\RichText\MarkdownContext;
use App\RichText\RichTextInput;
use App\RichText\Schema;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Illuminate\Validation\ValidationException;
use Tests\Support\RichTextFixtures as F;

$from = fn (array $input) => RichTextInput::from($input, 'description', new MarkdownContext);

$errors = function (array $input) use ($from): array {
    try {
        $from($input);
    } catch (ValidationException $invalid) {
        return $invalid->errors();
    }

    return [];
};

it('reads the Markdown field', function () use ($from) {
    expect($from(['description' => "So lässt sich der Fehler nachstellen:\n\n1. Öffnen\n2. Absenden"])?->toJson())->toBe(F::doc(
        F::p('So lässt sich der Fehler nachstellen:'),
        ['type' => 'orderedList', 'attrs' => ['start' => 1, 'type' => null], 'content' => [
            ['type' => 'listItem', 'content' => [F::p('Öffnen')]],
            ['type' => 'listItem', 'content' => [F::p('Absenden')]],
        ]],
    ));
});

it('reads the JSON field', function () use ($from) {
    expect($from(['description_json' => F::web47Steps()])?->toJson())->toBe(F::web47Steps());
});

it('refuses both fields at once', function () use ($errors) {
    expect($errors(['description' => 'a', 'description_json' => F::doc(F::p('a'))]))->toBe(['description' => [__('field.rich_text.both')]])
        ->and($errors(['description' => null, 'description_json' => null]))->toBe(['description' => [__('field.rich_text.both')]]);
});

it('refuses a document werkbuch does not know at the JSON field', function () use ($errors) {
    expect($errors(['description_json' => F::doc(F::p(['type' => 'mention', 'attrs' => ['id' => 'x']]))]))->toBe(['description_json' => [__('field.rich_text.invalid')]])
        ->and($errors(['description_json' => '{"type":"doc"}']))->toBe(['description_json' => [__('field.rich_text.invalid')]])
        ->and($errors(['description_json' => F::doc(F::p(str_repeat('x', Schema::MAX_BYTES)))]))->toBe(['description_json' => [__('field.rich_text.too_long')]]);
});

it('refuses Markdown werkbuch does not take at the Markdown field', function () use ($errors) {
    expect($errors(['description' => ['a']]))->toBe(['description' => [__('field.rich_text.invalid')]])
        ->and($errors(['description' => str_repeat('>', Schema::MAX_DEPTH).' tief']))->toBe(['description' => [__('field.rich_text.invalid')]])
        ->and($errors(['description' => str_repeat('x', Schema::MAX_BYTES)]))->toBe(['description' => [__('field.rich_text.too_long')]]);
});

it('says so in German', function () use ($errors) {
    app()->setLocale('de');

    expect($errors(['description' => 'a', 'description_json' => null]))->toBe(['description' => ['Schicke entweder Markdown oder JSON, nicht beides.']])
        ->and($errors(['description_json' => []]))->toBe(['description_json' => ['Der Text hat eine Form, die werkbuch nicht kennt.']])
        ->and($errors(['description' => str_repeat('x', Schema::MAX_BYTES)]))->toBe(['description' => ['Der Text ist zu lang.']]);
});

it('clears with an empty value or an empty document', function (array $input) use ($from) {
    expect(RichTextInput::given($input, 'description'))->toBeTrue()
        ->and($from($input))->toBeNull();
})->with([
    'empty Markdown' => [['description' => '']],
    'null Markdown' => [['description' => null]],
    'blank Markdown' => [['description' => "  \n\n "]],
    'null JSON' => [['description_json' => null]],
    'empty document' => [['description_json' => F::doc(['type' => 'paragraph'])]],
]);

it('knows whether the input sends the field', function () use ($from) {
    expect(RichTextInput::given([], 'description'))->toBeFalse()
        ->and(RichTextInput::given(['title' => 'x', 'description_text' => 'x'], 'description'))->toBeFalse()
        ->and(RichTextInput::given(['description' => 'x'], 'description'))->toBeTrue()
        ->and(RichTextInput::given(['description_json' => null], 'description'))->toBeTrue()
        ->and($from(['title' => 'x']))->toBeNull();
});

it('reaches the action with the spaces of its text nodes, through TrimStrings and ConvertEmptyStringsToNull', function () {
    // a test route: the REST routes with rich text come with Task 5
    Route::post('/rich-text-echo', fn (Request $request) => [
        'description' => RichTextInput::from($request->all(), 'description', new MarkdownContext)?->toJson(),
        'values' => $request->input('values'),
        'patch' => $request->input('patch'),
        'title' => $request->input('title'),
        'due_date' => $request->input('due_date'),
    ]);
    $spaced = F::doc(
        F::p(F::text('a '), F::text('b', 'bold'), F::text(' '), F::text('c', 'italic'), F::text(' d ')),
        F::p(['type' => 'text', 'marks' => [['type' => 'link', 'attrs' => array_replace(F::link('https://example.com'), ['title' => ''])]], 'text' => ' Doku ']),
    );

    $this->postJson('/rich-text-echo', [
        'description_json' => $spaced,
        'values' => ['steps' => $spaced],
        'patch' => ['values' => ['steps' => $spaced]],
        'title' => '  Titel  ',
        'due_date' => '',
    ])->assertOk()->assertExactJson([
        'description' => $spaced,
        'values' => ['steps' => $spaced],
        'patch' => ['values' => ['steps' => $spaced]],
        // everything else is still trimmed and emptied
        'title' => 'Titel',
        'due_date' => null,
    ]);
});
