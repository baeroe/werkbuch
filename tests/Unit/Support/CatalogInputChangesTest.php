<?php

use App\Support\CatalogInput;

it('names only the fields that changed, with the old and the new value', function () {
    expect(CatalogInput::changes(
        ['name' => 'UX', 'color' => 'sand', 'archived_at' => null],
        ['name' => 'Design', 'color' => 'sand', 'archived_at' => '2026-10-31T09:00:00.000000Z'],
    ))->toBe([
        'name' => ['old' => 'UX', 'new' => 'Design'],
        'archived_at' => ['old' => null, 'new' => '2026-10-31T09:00:00.000000Z'],
    ]);
});

it('is empty when nothing changed', function () {
    expect(CatalogInput::changes(['name' => 'UX', 'inward_label' => null], ['name' => 'UX', 'inward_label' => null]))->toBe([]);
});

it('compares strictly, so that null, an empty text and false differ', function () {
    expect(CatalogInput::changes(['a' => null, 'b' => '', 'c' => false, 'd' => [['x' => 1]]], ['a' => '', 'b' => false, 'c' => null, 'd' => [['x' => 2]]]))
        ->toBe([
            'a' => ['old' => null, 'new' => ''],
            'b' => ['old' => '', 'new' => false],
            'c' => ['old' => false, 'new' => null],
            'd' => ['old' => [['x' => 1]], 'new' => [['x' => 2]]],
        ]);
});

it('keeps the order of the new snapshot', function () {
    expect(array_keys(CatalogInput::changes(['b' => 1, 'a' => 1], ['a' => 2, 'b' => 2])))->toBe(['a', 'b']);
});
