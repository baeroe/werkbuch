<?php

use App\Access\ProjectRole;
use App\Actions\Pages\CreatePage;
use App\Actions\Pages\DeletePage;
use App\Actions\Pages\RestorePageVersion;
use App\Actions\Pages\UpdatePage;
use App\Actions\Projects\PurgeProject;
use App\Actions\WorkItems\DeleteWorkItem;
use App\Models\Attachment;
use App\Models\Page;
use App\Models\PageVersion;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use App\RichText\Document;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\RichTextFixtures as F;

/*
 * Which page names which item (Task 21t, A456): `page_item_references` follows the references of kind `item` in the
 * current text of a page (CreatePage, UpdatePage with a text that changes, RestorePageVersion), never a version and
 * never a key written as text, and only items there are; a row goes with its page, its subtree, its project and its
 * item. WEB (public) with Mara as its admin, Jonas as a member and Lene as a viewer; OPS (private) with Mara as its
 * admin. Items A, B, C in WEB, X in OPS.
 */

$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara', 'handle' => 'mara']);
    $web = Project::factory()->identifier('WEB')->public()->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $ops = Project::factory()->identifier('OPS')->private()->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $jonas = memberOf($web, ProjectRole::Member, ['name' => 'Jonas', 'handle' => 'jonas']);
    $lene = memberOf($web, ProjectRole::Viewer, ['name' => 'Lene', 'handle' => 'lene']);
    $item = fn (Project $project, string $title) => WorkItem::factory()->for($project)->create(['title' => $title, 'created_by' => $mara->id]);

    return [
        'mara' => $mara, 'web' => $web, 'ops' => $ops, 'jonas' => $jonas, 'lene' => $lene,
        'a' => $item($web, 'Anmeldung'), 'b' => $item($web, 'Bericht'), 'c' => $item($web, 'Cache'), 'x' => $item($ops, 'Server'),
    ];
};

/** The items a page names in the table, by ID. */
$refs = fn (Page $page): array => DB::table('page_item_references')->where('page_id', $page->id)->orderBy('work_item_id')->pluck('work_item_id')->all();

/** The IDs of the items, sorted like $refs. */
$ids = fn (WorkItem ...$items): array => collect($items)->pluck('id')->sort()->values()->all();

/** A text that names the items by reference, one paragraph. */
$naming = fn (WorkItem ...$items): array => F::doc(F::p('Siehe ', ...array_map(fn (WorkItem $item) => F::reference($item->id), $items)));

$create = fn (User $user, Project $project, array $input): Page => CreatePage::run(actor($user), $project, ['title' => 'Plan', ...$input]);

$save = fn (User $user, Page $page, array $input): Page => UpdatePage::run(actor($user), $page, $input);

it('records the items a new page references', function () use ($world, $refs, $ids, $naming, $create) {
    $w = $world();

    $page = $create($w['mara'], $w['web'], ['content_json' => $naming($w['a'], $w['b'], $w['a'])]);
    $empty = $create($w['mara'], $w['web'], []);
    // Markdown reads a key the writer sees as a reference: it counts like one written in the editor
    $markdown = $create($w['mara'], $w['web'], ['content' => "Hängt an {$w['x']->key}"]);

    expect($refs($page))->toBe($ids($w['a'], $w['b']))
        ->and($refs($empty))->toBe([])
        ->and($refs($markdown))->toBe([$w['x']->id])
        ->and(DB::table('page_item_references')->pluck('id')->every(fn (string $id) => Str::isUlid($id) && $id === strtolower($id)))->toBeTrue();
});

it('follows a saved text and leaves a save without text alone', function () use ($world, $refs, $ids, $naming, $create, $save) {
    $w = $world();
    $page = $create($w['mara'], $w['web'], ['content_json' => $naming($w['a'], $w['b'])]);

    $page = $save($w['mara'], $page, ['content_json' => $naming($w['b'], $w['c'])]);
    expect($refs($page))->toBe($ids($w['b'], $w['c']));

    // a row the text does not name: only a save that changes the text puts the table right
    DB::table('page_item_references')->insert(['id' => strtolower((string) Str::ulid()), 'page_id' => $page->id, 'work_item_id' => $w['a']->id]);
    $page = $save($w['mara'], $page, ['title' => 'Plan neu']);
    $page = $save($w['mara'], $page, ['title' => 'Plan neuer', 'content_json' => $naming($w['b'], $w['c'])]);
    expect($page->version)->toBe(4)
        ->and($refs($page))->toBe($ids($w['a'], $w['b'], $w['c']));

    $page = $save($w['mara'], $page, ['content_json' => $naming($w['c'])]);
    expect($refs($page))->toBe([$w['c']->id]);

    $page = $save($w['mara'], $page, ['content' => '']);
    expect($page->content)->toBeNull()
        ->and($refs($page))->toBe([]);
});

it('follows a restored version', function () use ($world, $refs, $naming, $create, $save) {
    $w = $world();
    $page = $create($w['mara'], $w['web'], ['content_json' => $naming($w['a'])]);
    // a save over another writer's state keeps that state as a version
    $page = $save($w['jonas'], $page, ['content_json' => $naming($w['b'])]);
    $kept = PageVersion::query()->where('page_id', $page->id)->sole();
    expect($refs($page))->toBe([$w['b']->id]);

    $page = RestorePageVersion::run(actor($w['jonas']), $page, $kept);

    expect($page->version)->toBe(3)
        ->and($refs($page))->toBe([$w['a']->id]);
});

it('counts only the current text, never a version', function () use ($world, $refs, $naming, $create, $save) {
    $w = $world();
    $page = $create($w['mara'], $w['web'], ['content_json' => $naming($w['a'])]);
    PageVersion::factory()->create(['page_id' => $page->id, 'version' => 7, 'content' => $naming($w['c'])]);

    $page = $save($w['mara'], $page, ['content_json' => $naming($w['b']), 'keep_current' => true]);

    $versions = PageVersion::query()->where('page_id', $page->id)->orderBy('version')->get();
    expect($versions->map(fn (PageVersion $version) => Document::fromJson((array) $version->content)->itemRefs())->all())->toBe([[$w['a']->id], [$w['c']->id]])
        ->and($refs($page))->toBe([$w['b']->id]);
});

it('counts only reference nodes, not a key as text', function () use ($world, $refs, $create) {
    $w = $world();
    $other = Page::factory()->create(['project_id' => $w['web']->id]);

    $page = $create($w['mara'], $w['web'], ['content_json' => F::doc(
        F::p("{$w['a']->key} steht hier nur als Text, ", F::reference($w['b']->id)),
        F::p(F::mention($w['jonas']->id, 'jonas'), ' und ', F::reference($other->id, 'page')),
    )]);
    // Markdown with a key written as text (escaped) keeps it text
    $markdown = $create($w['mara'], $w['web'], ['content' => str_replace('-', '\\-', $w['c']->key).' als Text']);

    expect($refs($page))->toBe([$w['b']->id])
        ->and(Document::fromJson((array) $markdown->content)->toText())->toBe("{$w['c']->key} als Text")
        ->and($refs($markdown))->toBe([]);
});

it('skips a referenced item that is gone', function () use ($world, $refs, $naming, $create, $save) {
    $w = $world();
    $page = $create($w['mara'], $w['web'], ['content_json' => $naming($w['a'], $w['b'])]);
    DeleteWorkItem::run(actor($w['mara']), $w['a']);

    // the text before named A: the rules of saving keep the node, the table names only items there are
    $page = $save($w['mara'], $page, ['content_json' => F::doc(F::p('Siehe ', F::reference($w['a']->id), F::reference($w['b']->id), ' neu'))]);

    expect(Document::fromJson((array) $page->content)->itemRefs())->toBe([$w['a']->id, $w['b']->id])
        ->and($refs($page))->toBe([$w['b']->id]);
});

it('drops the rows with the page, the subtree and the project', function () use ($world, $refs, $naming, $create) {
    $w = $world();
    $root = $create($w['mara'], $w['web'], ['content_json' => $naming($w['a'])]);
    $child = $create($w['mara'], $w['web'], ['parent_id' => $root->id, 'content_json' => $naming($w['b'])]);
    $kept = $create($w['mara'], $w['web'], ['content_json' => $naming($w['a'], $w['x'])]);
    $ops = $create($w['mara'], $w['ops'], ['content_json' => $naming($w['c'])]);
    expect($refs($child))->toBe([$w['b']->id]);

    DeletePage::run(actor($w['mara']), $root);
    expect(DB::table('page_item_references')->whereIn('page_id', [$root->id, $child->id])->count())->toBe(0)
        ->and($refs($kept))->toBe(collect([$w['a']->id, $w['x']->id])->sort()->values()->all())
        ->and($refs($ops))->toBe([$w['c']->id]);

    // OPS goes: its pages and its items take their rows with them, the page of WEB keeps the row to A
    $w['ops']->update(['deleting_at' => now()]);
    PurgeProject::run(actor(User::defaultBot()), $w['ops']);

    expect(DB::table('page_item_references')->get(['page_id', 'work_item_id'])->map(fn (object $row) => [$row->page_id, $row->work_item_id])->all())
        ->toBe([[$kept->id, $w['a']->id]]);
});

it('drops the rows with the item and keeps the node hidden', function () use ($world, $refs, $naming, $create) {
    $w = $world();
    $page = $create($w['mara'], $w['web'], ['content_json' => $naming($w['a'], $w['b'])]);

    DeleteWorkItem::run(actor($w['mara']), $w['a']);

    expect($refs($page))->toBe([$w['b']->id]);
    $this->actingAs($w['lene'])->getJson("/api/v1/pages/{$page->id}")
        ->assertOk()
        ->assertJsonPath('data.content', "Siehe [hidden](item:{$w['a']->id}){$w['b']->key}");
});

it('locks the items before the attachments when it saves, as DeleteWorkItem does (T21t-I1)', function () use ($world, $create, $save) {
    $w = $world();
    // a picture of A on the page and a reference to A: the row of A locks A (its foreign key), the link locks the picture
    $picture = Attachment::factory()->forItem($w['a'])->create(['uploaded_by' => $w['mara']->id]);
    $text = fn (WorkItem $item) => F::doc(F::image($picture->id, 'Skizze'), F::p('Siehe ', F::reference($item->id)));
    $order = function (callable $write): array {
        $statements = [];
        DB::listen(function (QueryExecuted $query) use (&$statements) {
            $statements[] = $query->sql;
        });
        $write();
        $row = array_key_first(array_filter($statements, fn (string $sql) => str_starts_with($sql, 'insert ignore into `page_item_references`')));
        $link = array_key_first(array_filter($statements, fn (string $sql) => str_contains($sql, 'from `attachments`') && str_ends_with($sql, 'for update')));
        expect($row)->not->toBeNull()
            ->and($link)->not->toBeNull();

        return [$row, $link];
    };

    $page = null;
    [$row, $link] = $order(function () use ($w, $create, $text, &$page) {
        $page = $create($w['mara'], $w['web'], ['content_json' => $text($w['a'])]);
    });
    expect($row)->toBeLessThan($link);

    [$row, $link] = $order(function () use ($w, $save, $text, &$page) {
        $page = $save($w['mara'], $page, ['content_json' => $text($w['b'])]);
    });
    expect($row)->toBeLessThan($link);

    $version = PageVersion::factory()->create(['page_id' => $page->id, 'version' => 1, 'content' => $text($w['c'])]);
    [$row, $link] = $order(fn () => RestorePageVersion::run(actor($w['mara']), $page, $version));
    expect($row)->toBeLessThan($link);
});

it('writes only the rows a page is missing (T21t-M1)', function () use ($world, $refs, $ids, $naming, $create, $save) {
    $w = $world();
    $page = $create($w['mara'], $w['web'], ['content_json' => $naming($w['a'])]);
    $first = DB::table('page_item_references')->where('page_id', $page->id)->value('id');
    $inserts = [];
    DB::listen(function (QueryExecuted $query) use (&$inserts) {
        if (str_starts_with($query->sql, 'insert ignore into `page_item_references`')) {
            $inserts[] = $query->bindings;
        }
    });

    $page = $save($w['mara'], $page, ['content_json' => $naming($w['a'], $w['b'])]);

    // one row of three values: B; the row of A stays the one it was
    expect($inserts)->toHaveCount(1)
        ->and($inserts[0])->toHaveCount(3)
        ->and($inserts[0][2])->toBe($w['b']->id)
        ->and($refs($page))->toBe($ids($w['a'], $w['b']))
        ->and(DB::table('page_item_references')->where('page_id', $page->id)->where('work_item_id', $w['a']->id)->value('id'))->toBe($first);
});

it('keeps the row of a hidden reference a writer sends back as Markdown (T21t-M3)', function () use ($world, $refs, $naming, $create) {
    $w = $world();
    $page = $create($w['mara'], $w['web'], ['content_json' => $naming($w['x'])]);

    // Jonas does not see OPS: he reads the reference hidden and writes it back with a change of his own
    $read = $this->actingAs($w['jonas'])->getJson("/api/v1/pages/{$page->id}")->assertOk();
    expect($read->json('data.content'))->toBe("Siehe [hidden](item:{$w['x']->id})");
    $this->actingAs($w['jonas'])->patchJson("/api/v1/pages/{$page->id}", [
        'content' => $read->json('data.content').' und mehr', 'base_version' => $read->json('data.version'),
    ])->assertOk();

    $saved = $page->fresh();
    expect(Document::fromJson((array) $saved?->content)->itemRefs())->toBe([$w['x']->id])
        ->and($saved?->content_text)->toBe('Siehe und mehr')
        ->and($refs($page))->toBe([$w['x']->id]);
});
