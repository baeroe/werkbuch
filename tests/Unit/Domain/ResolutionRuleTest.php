<?php

use App\Domain\Workflow\StateCategory;
use App\Domain\WorkItems\ResolutionChoice;
use App\Domain\WorkItems\ResolutionRule;

/** The resolutions of the clickdummy's fixtures, with some archived. */
$resolutions = fn (string ...$archived): array => array_map(
    fn (array $row) => new ResolutionChoice($row[0], $row[1], $row[2], in_array($row[0], $archived, true)),
    [
        ['res_done', StateCategory::Completed, 0],
        ['res_wontdo', StateCategory::Canceled, 1],
        ['res_duplicate', null, 2],
        ['res_cannot', null, 3],
    ],
);

it('sets the default of Completed when the transition gives no choice', function () use ($resolutions) {
    expect(ResolutionRule::after(StateCategory::Started, StateCategory::Completed, null, null, $resolutions()))->toBe('res_done');
});

it('sets the default of Canceled when the transition gives no choice', function () use ($resolutions) {
    expect(ResolutionRule::after(StateCategory::Started, StateCategory::Canceled, null, null, $resolutions()))->toBe('res_wontdo');
});

it('takes the chosen resolution over the default', function () use ($resolutions) {
    expect(ResolutionRule::after(StateCategory::Started, StateCategory::Canceled, null, 'res_duplicate', $resolutions()))->toBe('res_duplicate');
});

it('clears the resolution when the item is reopened', function () use ($resolutions) {
    expect(ResolutionRule::after(StateCategory::Completed, StateCategory::Unstarted, 'res_done', null, $resolutions()))->toBeNull()
        ->and(ResolutionRule::after(StateCategory::Canceled, StateCategory::Backlog, 'res_wontdo', null, $resolutions()))->toBeNull()
        ->and(ResolutionRule::after(StateCategory::Completed, StateCategory::Started, 'res_done', 'res_duplicate', $resolutions()))->toBeNull();
});

it('keeps the resolution while the item stays in a closed category', function () use ($resolutions) {
    expect(ResolutionRule::after(StateCategory::Completed, StateCategory::Completed, 'res_done', null, $resolutions()))->toBe('res_done')
        ->and(ResolutionRule::after(StateCategory::Canceled, StateCategory::Canceled, 'res_duplicate', null, $resolutions()))->toBe('res_duplicate');
});

it('switches to the default of the new category when an item moves between closed categories', function () use ($resolutions) {
    expect(ResolutionRule::after(StateCategory::Completed, StateCategory::Canceled, 'res_done', null, $resolutions()))->toBe('res_wontdo');
});

it('stays empty on moves between open categories', function () use ($resolutions) {
    expect(ResolutionRule::after(StateCategory::Backlog, StateCategory::Started, null, null, $resolutions()))->toBeNull();
});

it('ignores a chosen resolution that is archived or unknown', function () use ($resolutions) {
    expect(ResolutionRule::after(StateCategory::Started, StateCategory::Canceled, null, 'res_duplicate', $resolutions('res_duplicate')))->toBe('res_wontdo')
        ->and(ResolutionRule::after(StateCategory::Started, StateCategory::Canceled, null, 'res_nope', $resolutions()))->toBe('res_wontdo');
});

it('skips an archived default and gives nothing when no default is left', function () use ($resolutions) {
    expect(ResolutionRule::after(StateCategory::Started, StateCategory::Completed, null, null, $resolutions('res_done')))->toBeNull();
});

it('takes the default with the lowest position', function () {
    $resolutions = [
        new ResolutionChoice('res_late', StateCategory::Completed, 5, false),
        new ResolutionChoice('res_early', StateCategory::Completed, 1, false),
        new ResolutionChoice('res_earliest', StateCategory::Completed, 0, true),
    ];

    expect(ResolutionRule::after(StateCategory::Started, StateCategory::Completed, null, null, $resolutions))->toBe('res_early');
});
