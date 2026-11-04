<?php

use App\Access\ProjectRole;
use App\Models\Attachment;
use App\Models\Page;
use App\Models\PageVersion;
use App\Models\Project;
use App\Models\User;
use App\Support\PageLock;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;

// The pages of a wiki and their versions as stored (spec 4.15, plan "Datenmodell").

it('orders children by rank byte by byte', function () {
    $parent = Page::factory()->create();
    Page::factory()->childOf($parent)->create(['rank' => 'a0', 'title' => 'Lower case']);
    Page::factory()->childOf($parent)->create(['rank' => 'Zz', 'title' => 'Upper case']);

    // the collation of the other texts would put `a0` first ("A" = "a"); byte by byte "Z" (0x5A) comes before "a" (0x61)
    expect($parent->children->pluck('rank')->all())->toBe(['Zz', 'a0']);
});

it('ranks a page after its last sibling, per row of siblings', function () {
    $project = Project::factory()->create();
    [$first, $second] = Page::factory()->count(2)->create(['project_id' => $project->id])->all();
    $child = Page::factory()->childOf($first)->create();
    $third = Page::factory()->create(['project_id' => $project->id]);

    expect(strcmp($first->rank, $second->rank))->toBeLessThan(0)
        ->and(strcmp($second->rank, $third->rank))->toBeLessThan(0)
        ->and($child->rank)->toBe('a0')
        ->and(PageLock::pages($project)->all())->toBe([
            $first->id => null, $child->id => $first->id, $second->id => null, $third->id => null,
        ]);
});

it('keeps one version per page and number', function () {
    $page = Page::factory()->create();
    PageVersion::factory()->create(['page_id' => $page->id]);

    PageVersion::factory()->create(['page_id' => $page->id]);
})->throws(UniqueConstraintViolationException::class);

it('takes the subtree and the versions with the project', function () {
    $project = Project::factory()->create();
    $other = Page::factory()->create();
    // deeper than the 15 levels InnoDB cascades (K1): each page goes by its project, `parent_id` only becomes null
    $page = Page::factory()->create(['project_id' => $project->id]);
    foreach (range(1, 19) as $level) {
        $page = Page::factory()->childOf($page)->create();
        PageVersion::factory()->create(['page_id' => $page->id]);
    }

    $project->delete();

    expect(Page::query()->pluck('id')->all())->toBe([$other->id])
        ->and(PageVersion::query()->count())->toBe(0);
});

it('lets a child stay when its parent row goes', function () {
    $parent = Page::factory()->create();
    $child = Page::factory()->childOf($parent)->create();

    $parent->delete();

    expect($child->fresh()?->parent_id)->toBeNull();
});

it('stores the emoji byte by byte', function () {
    $project = Project::factory()->create();
    $plain = Page::factory()->create(['project_id' => $project->id, 'emoji' => '👍']);
    $toned = Page::factory()->create(['project_id' => $project->id, 'emoji' => '👍🏽']);

    expect(Page::query()->where('emoji', '👍')->pluck('id')->all())->toBe([$plain->id])
        ->and(Page::query()->where('emoji', '👍🏽')->pluck('id')->all())->toBe([$toned->id])
        ->and($toned->fresh()?->emoji)->toBe('👍🏽');
});

it('knows its project, parent, authors, versions newest first and attachments', function () {
    $author = User::factory()->create();
    $editor = User::factory()->create();
    $parent = Page::factory()->create(['created_by' => $author->id, 'updated_by' => $editor->id, 'version' => 3]);
    $child = Page::factory()->childOf($parent)->create();
    foreach ([1, 2] as $number) {
        PageVersion::factory()->create(['page_id' => $parent->id, 'version' => $number, 'author_id' => $author->id]);
    }
    $attachment = Attachment::factory()->create([
        'project_id' => $parent->project_id, 'attachable_type' => 'page', 'attachable_id' => $parent->id,
    ]);
    $version = $parent->versions->first();

    expect($parent->project->id)->toBe($parent->project_id)
        ->and($child->parent?->id)->toBe($parent->id)
        ->and($parent->creator->id)->toBe($author->id)
        ->and($parent->editor->id)->toBe($editor->id)
        ->and($parent->versions->pluck('version')->all())->toBe([2, 1])
        ->and($parent->attachments->modelKeys())->toBe([$attachment->id])
        ->and($version?->page->id)->toBe($parent->id)
        ->and($version?->author->id)->toBe($author->id)
        ->and($version?->created_at)->toBeInstanceOf(DateTimeInterface::class)
        ->and($attachment->attachable?->is($parent))->toBeTrue();
});

it('keeps the saved state of the page in a version made by the factory', function () {
    $page = Page::factory()->withText('Die **Abnahme** steht.')->create(['version' => 4]);

    $version = PageVersion::factory()->create(['page_id' => $page->id]);

    expect($version->only(['version', 'title', 'content', 'author_id']))->toBe([
        'version' => 4, 'title' => $page->title, 'content' => $page->content, 'author_id' => $page->updated_by,
    ])
        ->and($version->created_at?->toIso8601String())->toBe($page->updated_at?->toIso8601String())
        ->and($page->content_text)->toBe('Die Abnahme steht.');
});

it('shows only the pages of the projects the account sees', function () {
    $reader = User::factory()->create();
    $mine = Page::factory()->create(['project_id' => Project::factory()->private()->member($reader, ProjectRole::Viewer)->create()->id]);
    $public = Page::factory()->create(['project_id' => Project::factory()->public()->create()->id]);
    Page::factory()->create(['project_id' => Project::factory()->private()->create()->id]);
    Page::factory()->create(['project_id' => Project::factory()->public()->create(['deleting_at' => now()])->id]);

    expect(Page::query()->visibleTo($reader)->orderBy('id')->pluck('id')->all())->toBe(collect([$mine->id, $public->id])->sort()->values()->all());
});

it('prepares pages for the resource with a fixed number of queries', function () {
    $reader = User::factory()->create();
    $mara = User::factory()->create(['handle' => 'mara']);
    $mention = ['type' => 'doc', 'content' => [['type' => 'paragraph', 'content' => [['type' => 'mention', 'attrs' => ['id' => $mara->id]]]]]];
    $pages = Page::factory()->count(3)->create(['content' => $mention]);
    $pages->push(Page::factory()->create());
    $pages = Page::query()->whereKey($pages->modelKeys())->get();

    $queries = 0;
    DB::listen(function () use (&$queries) {
        $queries++;
    });
    Page::loadForResource($pages, $reader);
    $full = $queries;
    $lean = Page::query()->whereKey($pages->modelKeys())->get();
    $queries = 0;
    Page::loadForResource($lean, $reader, true);
    $leanQueries = $queries;
    $single = Page::query()->findOrFail($pages->first()?->id);
    Page::loadForResource($single, $reader);

    expect($full)->toBe(1)
        ->and($leanQueries)->toBe(0)
        ->and($pages->every(fn (Page $page) => ! $page->lean && $page->rich_names?->handles === [$mara->id => 'mara']))->toBeTrue()
        ->and($lean->every(fn (Page $page) => $page->lean && $page->rich_names === null))->toBeTrue()
        ->and($single->rich_names?->handles)->toBe([$mara->id => 'mara']);
});
