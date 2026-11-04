<?php

use App\Access\Authorize;
use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Access\Visibility;
use App\Exceptions\Problem;
use App\Models\Page;
use App\Models\User;
use Tests\Feature\Access\MatrixWorld;

// The rights at the wiki for each column of the rights matrix (spec 4.3): the public project WEB, the private project
// OPS for the outsider of the private project.

beforeEach(function () {
    $this->world = MatrixWorld::build();
});

/**
 * The outcome of the ability for the account: 'allowed', 404 or the sentence of the 403. On the project: the tree
 * (`viewAny`) or a new page (`create`); otherwise a page of the project of the column.
 */
$outcome = function (string $column, string $ability, bool $onProject = false, ?User $user = null): string|int {
    $world = $this->world;
    $argument = $onProject ? [Page::class, $world->project($column)] : [$world->page($column)];

    try {
        Authorize::check(actor($user ?? $world->account($column)), $ability, ...$argument);

        return 'allowed';
    } catch (Problem $problem) {
        return $problem->status === 404 ? 404 : (string) $problem->detail;
    }
};

it('lets everybody who sees the project read its wiki', function (string $column, string|int $expected) use ($outcome) {
    expect($outcome->call($this, $column, 'viewAny', true))->toBe($expected)
        ->and($outcome->call($this, $column, 'view'))->toBe($expected);
})->with([
    ['org_admin', 'allowed'], ['project_admin', 'allowed'], ['project_member', 'allowed'], ['project_viewer', 'allowed'],
    ['outsider_public', 'allowed'], ['outsider_private', 404], ['default_bot', 'allowed'],
]);

it('lets members and admins write the wiki', function (string $column, bool $allowed) use ($outcome) {
    $refusal = __('problem.detail.wiki_members_only');
    $expected = $allowed ? 'allowed' : ($column === 'outsider_private' ? 404 : $refusal);

    expect($outcome->call($this, $column, 'create', true))->toBe($expected)
        ->and($outcome->call($this, $column, 'update'))->toBe($expected)
        ->and($refusal)->toBe('Only members and admins of the project edit the wiki.');
})->with([
    ['org_admin', true], ['project_admin', true], ['project_member', true], ['project_viewer', false],
    ['outsider_public', false], ['outsider_private', false], ['default_bot', true],
]);

it('lets a bot write the wiki as a member and read it as an outsider of a public project', function () use ($outcome) {
    $bot = $this->world->bot;

    expect($outcome->call($this, 'project_admin', 'update', false, $bot))->toBe(__('problem.detail.wiki_members_only'))
        ->and($outcome->call($this, 'project_admin', 'view', false, $bot))->toBe('allowed')
        ->and($outcome->call($this, 'outsider_private', 'view', false, $bot))->toBe(404);

    app(RoleAssignments::class)->setProjectRole($bot, $this->world->web, ProjectRole::Member);
    Visibility::forget();

    expect($outcome->call($this, 'project_admin', 'create', true, $bot))->toBe('allowed')
        ->and($outcome->call($this, 'project_admin', 'update', false, $bot))->toBe('allowed');
});

it('hides the wiki of a project being deleted from everybody', function (string $column) use ($outcome) {
    $page = $this->world->page($column);
    $this->world->project($column)->update(['deleting_at' => now()]);
    Visibility::forget();

    expect($outcome->call($this, $column, 'viewAny', true))->toBe(404)
        ->and($outcome->call($this, $column, 'create', true))->toBe(404)
        ->and(refusal($this->world->account($column), 'view', $page->fresh())->status)->toBe(404)
        ->and(refusal($this->world->account($column), 'update', $page->fresh())->status)->toBe(404);
})->with(['org_admin', 'project_admin', 'project_viewer']);

it('hides the wiki from a deactivated account', function () use ($outcome) {
    $member = $this->world->account('project_member');
    $member->update(['disabled_at' => now()]);
    Visibility::forget();

    expect($outcome->call($this, 'project_member', 'viewAny', true))->toBe(404)
        ->and($outcome->call($this, 'project_member', 'view'))->toBe(404)
        ->and($outcome->call($this, 'project_member', 'update'))->toBe(404);
});
