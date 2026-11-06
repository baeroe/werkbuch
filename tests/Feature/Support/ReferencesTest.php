<?php

use App\Exceptions\Problem;
use App\Models\Comment;
use App\Models\Project;
use App\Models\View;
use App\Models\WorkItem;
use App\Support\References;
use Illuminate\Support\Str;

/*
 * How REST (the bindings of routes/api.php) and MCP find a row by the reference a client sends: a project by ULID,
 * identifier or former identifier, an item by ULID or key, every other row by its ULID; unknown is 404. Whether the
 * account sees it, the action decides.
 */

it('finds a project by ULID, identifier and former identifier', function () {
    $project = Project::factory()->identifier('WEB')->create();
    $project->identifiers()->create(['identifier' => 'OLD']);

    foreach ([$project->id, strtoupper($project->id), 'WEB', 'web', 'OLD', 'old'] as $ref) {
        expect(References::project($ref)->is($project))->toBeTrue($ref);
    }
});

it('finds an item by key in any case and marks a former key', function () {
    $project = Project::factory()->identifier('WEB')->create();
    $project->identifiers()->create(['identifier' => 'OLD']);
    $item = WorkItem::factory()->for($project)->create();

    $byKey = References::item('web-1');
    $byFormer = References::item('old-1');

    expect($byKey->is($item))->toBeTrue()
        ->and($byKey->resolved_by_former_identifier)->toBeFalse()
        ->and($byFormer->is($item))->toBeTrue()
        ->and($byFormer->resolved_by_former_identifier)->toBeTrue()
        ->and($byFormer->key)->toBe('WEB-1');
});

it('finds by an upper-case ULID', function () {
    $item = WorkItem::factory()->create();
    $view = View::factory()->create();
    $comment = Comment::factory()->create();

    expect(References::item(strtoupper($item->id))->is($item))->toBeTrue()
        ->and(References::ulid(View::class, strtoupper($view->id))->is($view))->toBeTrue()
        ->and(References::ulid(Comment::class, strtoupper($comment->id))->is($comment))->toBeTrue()
        ->and(References::ulid(View::class, $view->id))->toBeInstanceOf(View::class);
});

it('answers an unknown or non-ULID reference with 404', function (Closure $find) {
    Project::factory()->identifier('WEB')->create();
    View::factory()->create();

    try {
        $find();
        $this->fail('found something');
    } catch (Problem $problem) {
        expect($problem->status)->toBe(404)->and($problem->reason)->toBe('not_found')->and($problem->detail)->toBeNull();
    }
})->with([
    'project unknown' => fn () => References::project('NOPE'),
    'project by unknown ULID' => fn () => References::project((string) Str::ulid()),
    'item by unknown key' => fn () => References::item('WEB-99'),
    'item by no key' => fn () => References::item('nonsense'),
    'item by unknown ULID' => fn () => References::item((string) Str::ulid()),
    'ulid unknown' => fn () => References::ulid(View::class, (string) Str::ulid()),
    'not a ULID' => fn () => References::ulid(View::class, 'WEB'),
    'a ULID of another kind' => fn () => References::ulid(View::class, Project::query()->sole()->id),
]);
