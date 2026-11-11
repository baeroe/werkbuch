<?php

use App\Access\ProjectRole;
use App\Actions\Pages\CreatePage;
use App\Actions\Pages\ListItemPages;
use App\Actions\Pages\UpdatePage;
use App\Exceptions\Problem;
use App\Models\Page;
use App\Models\PageVersion;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use App\RichText\Document;
use App\Support\PageItemReferences;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Tests\Support\RichTextFixtures as F;

/*
 * The wiki pages that name an item (Task 21u, A456): the pages whose current text references the item
 * (`page_item_references`), only those of the projects the reader sees (archived ones too, never one being deleted),
 * lean, by title, then ULID, a page at a time; the total counts nothing the reader does not see. WEB (public) with
 * Mara as its admin and Lene as a viewer; OPS (private) with Mara as its admin; Ida is in neither.
 */

$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara', 'handle' => 'mara']);
    $web = Project::factory()->identifier('WEB')->public()->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $ops = Project::factory()->identifier('OPS')->private()->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $lene = memberOf($web, ProjectRole::Viewer, ['name' => 'Lene', 'handle' => 'lene']);
    $ida = User::factory()->create(['name' => 'Ida', 'handle' => 'ida']);
    $item = WorkItem::factory()->for($web)->create(['title' => 'Anmeldung', 'created_by' => $mara->id]);

    return compact('mara', 'web', 'ops', 'lene', 'ida', 'item');
};

/** A page of the project whose text references the items, recorded as CreatePage records it. */
$naming = function (Project $project, string $title, WorkItem ...$items): Page {
    $page = Page::factory()->create([
        'project_id' => $project->id, 'title' => $title,
        'content' => F::doc(F::p('Siehe ', ...array_map(fn (WorkItem $item) => F::reference($item->id), $items))),
    ]);
    PageItemReferences::sync($page, Document::fromJson($page->content));

    return $page;
};

$titles = fn ($result): array => array_column($result->page->items(), 'title');

$refusal = function (callable $call): ?int {
    try {
        $call();
    } catch (Problem $problem) {
        return $problem->getStatusCode();
    }

    return null;
};

it('lists the pages that reference an item, by title', function () use ($world, $naming, $titles) {
    $w = $world();
    $other = WorkItem::factory()->for($w['web'])->create(['created_by' => $w['mara']->id]);
    // written over the API in Markdown: the key the writer sees is a reference
    $written = CreatePage::run(actor($w['mara']), $w['web'], ['title' => 'Zeitplan', 'content' => "Hängt an {$w['item']->key}."]);
    $alpha = $naming($w['web'], 'alpha', $w['item'], $other);
    $apfel = $naming($w['web'], 'Äpfel', $w['item']);
    $twin = $naming($w['web'], 'alpha', $w['item']);
    $naming($w['web'], 'Nur das andere', $other);
    // a key as text names nothing
    Page::factory()->withText("Siehe {$w['item']->key}")->create(['project_id' => $w['web']->id, 'title' => 'Text']);
    // nor does a version: the page named the item, its current text no longer does, the kept version still does
    $earlier = CreatePage::run(actor($w['mara']), $w['web'], ['title' => 'Früher', 'content' => "Hing an {$w['item']->key}."]);
    UpdatePage::run(actor($w['mara']), $earlier, ['content' => 'Hängt an nichts mehr.', 'keep_current' => true]);
    expect(Document::fromJson(PageVersion::query()->where('page_id', $earlier->id)->sole()->content)->itemRefs())->toBe([$w['item']->id]);

    $result = ListItemPages::run(actor($w['lene']), $w['item'], []);
    $first = $result->page->items()[0];

    // by the collation (Äpfel after alpha, before Zeitplan), equal titles by ULID
    expect($titles($result))->toBe(['alpha', 'alpha', 'Äpfel', 'Zeitplan'])
        ->and(array_column($result->page->items(), 'id'))->toBe([...collect([$alpha->id, $twin->id])->sort()->values(), $apfel->id, $written->id])
        ->and($result->total)->toBe(4)
        // lean: the text is never read
        ->and(array_keys($first->getAttributes()))->toEqualCanonicalizing(Page::LEAN_COLUMNS)
        ->and($first->lean)->toBeTrue()
        // by its key
        ->and($titles(ListItemPages::run(actor($w['lene']), $w['item']->key, [])))->toBe($titles($result));
});

it('pages with a cursor through the pages of an item', function () use ($world, $naming) {
    $w = $world();
    foreach (['C', 'A', 'B'] as $title) {
        $naming($w['web'], $title, $w['item']);
    }

    $first = ListItemPages::run(actor($w['lene']), $w['item'], ['per_page' => 2]);
    $next = ListItemPages::run(actor($w['lene']), $w['item'], ['per_page' => 2, 'cursor' => $first->page->nextCursor()?->encode()]);

    expect(array_column($first->page->items(), 'title'))->toBe(['A', 'B'])
        ->and(array_column($next->page->items(), 'title'))->toBe(['C'])
        ->and([$first->total, $next->total])->toBe([3, 3])
        ->and(fn () => ListItemPages::run(actor($w['lene']), $w['item'], ['filter' => ['title' => 'A']]))->toThrow(ValidationException::class);
});

it('shows only pages the reader sees and counts only those', function () use ($world, $naming, $titles) {
    $w = $world();
    $naming($w['web'], 'Öffentlich', $w['item']);
    $naming($w['ops'], 'Geheim', $w['item']);

    $lene = ListItemPages::run(actor($w['lene']), $w['item'], []);
    $mara = ListItemPages::run(actor($w['mara']), $w['item'], []);

    expect($titles($lene))->toBe(['Öffentlich'])
        ->and($lene->total)->toBe(1)
        ->and($titles($mara))->toBe(['Geheim', 'Öffentlich'])
        ->and($mara->total)->toBe(2);

    // an item only a hidden page names: an empty list, no total that tells of it
    $alone = WorkItem::factory()->for($w['web'])->create(['created_by' => $w['mara']->id]);
    $naming($w['ops'], 'Nur geheim', $alone);
    $empty = ListItemPages::run(actor($w['ida']), $alone, []);
    expect($empty->page->items())->toBe([])
        ->and($empty->total)->toBe(0)
        ->and(ListItemPages::run(actor($w['mara']), $alone, [])->total)->toBe(1);
});

it('answers an invisible item with 404', function () use ($world, $naming, $refusal) {
    $w = $world();
    $secret = WorkItem::factory()->for($w['ops'])->create(['created_by' => $w['mara']->id]);
    $naming($w['web'], 'Öffentlich', $secret);

    expect($refusal(fn () => ListItemPages::run(actor($w['lene']), $secret, [])))->toBe(404)
        ->and($refusal(fn () => ListItemPages::run(actor($w['lene']), $secret->key, [])))->toBe(404)
        ->and($refusal(fn () => ListItemPages::run(actor($w['lene']), 'NOPE-1', [])))->toBe(404)
        ->and(ListItemPages::run(actor($w['mara']), $secret, [])->total)->toBe(1);
});

it('lists pages of an archived project, never of one being deleted', function () use ($world, $naming, $titles) {
    $w = $world();
    $old = Project::factory()->identifier('OLD')->public()->archived()->member($w['mara'], ProjectRole::Admin)->create();
    $gone = Project::factory()->identifier('GONE')->public()->member($w['mara'], ProjectRole::Admin)->create();
    $naming($old, 'Archiviert', $w['item']);
    $naming($gone, 'Verschwindet', $w['item']);
    $gone->update(['deleting_at' => now()]);

    $result = ListItemPages::run(actor($w['mara']), $w['item'], []);

    expect($titles($result))->toBe(['Archiviert'])
        ->and($result->total)->toBe(1)
        ->and($titles(ListItemPages::run(actor($w['lene']), $w['item'], [])))->toBe(['Archiviert']);
});

it('asks the same number of queries for 2 and 40 pages', function () use ($world, $naming) {
    $w = $world();
    $count = function (int $pages) use ($w, $naming): int {
        Page::query()->delete();
        foreach (range(1, $pages) as $n) {
            $naming($n % 2 === 0 ? $w['web'] : $w['ops'], "Seite {$n}", $w['item']);
        }

        // the roles of the reader, as the request reads them before
        ListItemPages::run(actor($w['mara']), $w['item'], []);
        DB::enableQueryLog();
        DB::flushQueryLog();
        $result = ListItemPages::run(actor($w['mara']), $w['item'], []);
        $queries = count(DB::getQueryLog());
        DB::disableQueryLog();
        expect($result->page->items())->toHaveCount($pages);

        return $queries;
    };

    expect($count(2))->toBe($count(40));
});
