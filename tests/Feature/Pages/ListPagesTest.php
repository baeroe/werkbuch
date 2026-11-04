<?php

use App\Access\ProjectRole;
use App\Actions\Pages\ListPages;
use App\Exceptions\Problem;
use App\Http\Resources\PageNodeResource;
use App\Models\Page;
use App\Models\Project;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/*
 * Reading the tree of a wiki (Task 3, A315): every page of the project in one query, without its text, the siblings by
 * rank byte by byte, then the ULID; PageNodeResource::tree() nests them without asking the database again.
 */

$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara', 'handle' => 'mara']);
    $web = Project::factory()->identifier('WEB')->public()->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);

    return compact('mara', 'web');
};

// as the response writes it: the nested children only become arrays when serialized
$tree = fn ($pages): array => json_decode((string) json_encode(PageNodeResource::tree($pages)), true);

it('lists the tree of a project by rank, without content', function () use ($world, $tree) {
    $w = $world();
    $second = Page::factory()->withText('Zweite Seite')->create(['project_id' => $w['web']->id, 'rank' => 'a0', 'title' => 'Zweite']);
    // byte by byte "Z" (0x5A) comes before "a" (0x61)
    $first = Page::factory()->withText('Erste Seite')->create(['project_id' => $w['web']->id, 'rank' => 'Zz', 'title' => 'Erste']);
    $child = Page::factory()->childOf($second)->withText('Kind')->create(['rank' => 'a1', 'title' => 'Kind']);
    $older = Page::factory()->childOf($second)->create(['rank' => 'a0', 'title' => 'Älteres Kind']);
    $grandchild = Page::factory()->childOf($child)->withText('Enkel')->create(['title' => 'Enkel']);
    Page::factory()->create(['title' => 'Anderes Projekt']);

    $pages = ListPages::run(actor($w['mara']), $w['web']);
    $nodes = $tree($pages);

    expect($pages)->toHaveCount(5)
        ->and(array_column($nodes, 'id'))->toBe([$first->id, $second->id])
        ->and(array_column($nodes[1]['children'], 'id'))->toBe([$older->id, $child->id])
        ->and(array_column($nodes[1]['children'][1]['children'], 'id'))->toBe([$grandchild->id])
        ->and($nodes[1]['children'][1]['children'][0]['children'])->toBe([])
        ->and($nodes[0]['children'])->toBe([])
        ->and(array_keys($nodes[1]['children'][1]['children'][0]))->toBe([
            'id', 'project_id', 'parent_id', 'rank', 'title', 'emoji', 'version', 'created_by', 'created_at', 'updated_by', 'updated_at', 'children',
        ])
        ->and($nodes[1]['children'][1]['children'][0]['parent_id'])->toBe($child->id)
        // the text was never read
        ->and($pages->every(fn (Page $page) => ! array_key_exists('content', $page->getAttributes()) && ! array_key_exists('content_text', $page->getAttributes())))->toBeTrue();
});

it('reads the project by its identifier', function () use ($world) {
    $w = $world();
    $page = Page::factory()->create(['project_id' => $w['web']->id]);

    expect(ListPages::run(actor($w['mara']), 'web')->modelKeys())->toBe([$page->id]);
});

it('answers 404 for an unknown project, a private project of someone else and for one being deleted', function () use ($world) {
    $w = $world();
    $ops = Project::factory()->identifier('OPS')->private()->create();
    Page::factory()->create(['project_id' => $ops->id]);
    $deleting = Project::factory()->identifier('OLD')->member($w['mara'], ProjectRole::Admin)->create(['deleting_at' => now()]);

    $refusal = function (callable $call): ?int {
        try {
            $call();
        } catch (Problem $problem) {
            return $problem->getStatusCode();
        }

        return null;
    };

    expect($refusal(fn () => ListPages::run(actor($w['mara']), 'NOPE')))->toBe(404)
        ->and($refusal(fn () => ListPages::run(actor($w['mara']), $ops)))->toBe(404)
        ->and($refusal(fn () => ListPages::run(actor($w['mara']), $deleting)))->toBe(404)
        ->and($refusal(fn () => ListPages::run(actor($w['mara']), 'OLD')))->toBe(404);
});

it('lets a viewer and an outsider of a public project read, also when it is archived', function () use ($world) {
    $w = $world();
    $page = Page::factory()->create(['project_id' => $w['web']->id]);
    $viewer = memberOf($w['web'], ProjectRole::Viewer);
    $outsider = User::factory()->create();
    $w['web']->update(['archived' => true]);

    expect(ListPages::run(actor($viewer), $w['web'])->modelKeys())->toBe([$page->id])
        ->and(ListPages::run(actor($outsider), 'WEB')->modelKeys())->toBe([$page->id]);
});

it('asks the database as often for 100 pages as for 5', function () use ($world, $tree) {
    $w = $world();
    $count = function (int $pages) use ($w, $tree): int {
        Page::query()->delete();
        // a chain and some siblings: every level is built from the one query
        $parent = null;
        foreach (range(1, $pages) as $n) {
            $page = Page::factory()->create(['project_id' => $w['web']->id, 'parent_id' => $n % 3 === 0 ? null : $parent?->id]);
            $parent = $page;
        }

        // the roles of the reader, as the request reads them before
        ListPages::run(actor($w['mara']), 'WEB');
        DB::enableQueryLog();
        DB::flushQueryLog();
        $nodes = $tree(ListPages::run(actor($w['mara']), 'WEB'));
        $queries = count(DB::getQueryLog());
        DB::disableQueryLog();

        $total = 0;
        $walk = function (array $nodes) use (&$walk, &$total): void {
            foreach ($nodes as $node) {
                $total++;
                $walk($node['children']);
            }
        };
        $walk($nodes);
        expect($total)->toBe($pages);

        return $queries;
    };

    expect($count(100))->toBe($count(5));
});
