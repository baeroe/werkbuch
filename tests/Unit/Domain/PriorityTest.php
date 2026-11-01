<?php

use App\Domain\WorkItems\Priority;

it('has the values of the Priority union of the frontend', function () {
    preg_match('/export type Priority = ([^;]+);/', (string) file_get_contents(repo_path('resources/js/types.ts')), $match);
    preg_match_all("/'([a-z]+)'/", $match[1] ?? '', $values);

    expect($values[1])->toBe(['urgent', 'high', 'medium', 'low', 'none'])
        ->and(array_map(fn (Priority $priority) => $priority->value, Priority::cases()))->toBe($values[1]);
});

it('orders the priorities from urgent to none', function () {
    expect(Priority::ORDER)->toBe([Priority::Urgent, Priority::High, Priority::Medium, Priority::Low, Priority::None]);
});
