<?php

use App\Domain\Workflow\StateCategory;

it('names every category in a sentence, in both languages', function (string $locale, array $names) {
    app()->setLocale($locale);

    expect(array_map(fn (StateCategory $category) => $category->label(), StateCategory::cases()))->toBe($names);
})->with([
    'English' => ['en', ['Backlog', 'Unstarted', 'Started', 'Completed', 'Canceled']],
    'German' => ['de', ['Backlog', 'Unstarted', 'Started', 'Completed', 'Canceled']],
]);
