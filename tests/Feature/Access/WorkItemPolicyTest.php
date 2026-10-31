<?php

use App\Access\Authorize;
use App\Exceptions\Problem;
use App\Models\WorkItem;
use Tests\Feature\Access\MatrixWorld;

// The rights at a work item for each column of the rights matrix: the public project WEB, the private project OPS for
// the outsider of the private project.

beforeEach(function () {
    $this->world = MatrixWorld::build();
});

/**
 * The outcome of the ability for the column: 'allowed', 404 or the sentence of the 403.
 */
$outcome = function (string $column, string $ability, bool $onProject = false): string|int {
    $world = $this->world;
    $argument = $onProject ? [WorkItem::class, $world->project($column)] : [$world->item($column)];

    try {
        Authorize::check(actor($world->account($column)), $ability, ...$argument);

        return 'allowed';
    } catch (Problem $problem) {
        return $problem->status === 404 ? 404 : (string) $problem->detail;
    }
};

it('lets everybody who sees the project see its items', function (string $column, string|int $expected) use ($outcome) {
    expect($outcome->call($this, $column, 'view'))->toBe($expected);
})->with([
    ['org_admin', 'allowed'], ['project_admin', 'allowed'], ['project_member', 'allowed'], ['project_viewer', 'allowed'],
    ['outsider_public', 'allowed'], ['outsider_private', 404], ['default_bot', 'allowed'],
]);

it('lets members and admins create and change items', function (string $column, bool $allowed) use ($outcome) {
    $refusal = __('problem.detail.items_members_only');
    $expected = $allowed ? 'allowed' : ($column === 'outsider_private' ? 404 : $refusal);

    expect($outcome->call($this, $column, 'create', true))->toBe($expected)
        ->and($outcome->call($this, $column, 'update'))->toBe($expected)
        ->and($refusal)->not->toStartWith('problem.');
})->with([
    ['org_admin', true], ['project_admin', true], ['project_member', true], ['project_viewer', false],
    ['outsider_public', false], ['outsider_private', false], ['default_bot', true],
]);

it('lets only admins delete items', function (string $column, bool $allowed) use ($outcome) {
    $expected = $allowed ? 'allowed' : ($column === 'outsider_private' ? 404 : __('problem.detail.items_delete_admins_only'));

    expect($outcome->call($this, $column, 'delete'))->toBe($expected);
})->with([
    ['org_admin', true], ['project_admin', true], ['project_member', false], ['project_viewer', false],
    ['outsider_public', false], ['outsider_private', false], ['default_bot', true],
]);

it('lets the people who see an item watch it, never a bot', function (string $column, string|int $expected) use ($outcome) {
    expect($outcome->call($this, $column, 'watch'))->toBe(is_string($expected) && $expected !== 'allowed' ? __($expected) : $expected);
})->with([
    ['org_admin', 'allowed'], ['project_admin', 'allowed'], ['project_member', 'allowed'], ['project_viewer', 'allowed'],
    ['outsider_public', 'allowed'], ['outsider_private', 404], ['default_bot', 'problem.detail.bots_dont_watch'],
]);

it('hides the items of a private project from a bot outside it', function () {
    $item = $this->world->item('outsider_private', 'closed');

    expect(refusal($this->world->bot, 'watch', $item)->status)->toBe(404)
        ->and(refusal($this->world->bot, 'view', $item)->status)->toBe(404)
        ->and($item->closed_at)->not->toBeNull();
});
