<?php

use App\Access\ProjectRole;
use App\Actions\Pages\GetPage;
use App\Exceptions\Problem;
use App\Http\Resources\PageResource;
use App\Models\Page;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use Illuminate\Http\Request;
use Tests\Support\RichTextFixtures as F;

/*
 * Reading one page (Task 3): whoever sees its project; the text as Markdown for its reader (the current handles, the keys
 * of the items the reader sees, A229) and as stored Tiptap JSON.
 */

$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara', 'handle' => 'mara']);
    $web = Project::factory()->identifier('WEB')->public()->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $lene = memberOf($web, ProjectRole::Viewer, ['name' => 'Lene', 'handle' => 'lene']);

    return compact('mara', 'web', 'lene');
};

$shown = fn (Page $page): array => (new PageResource($page))->resolve(Request::create('/'));

it('answers the page with Markdown for the reader and the JSON as stored', function () use ($world, $shown) {
    $w = $world();
    $item = WorkItem::factory()->for($w['web'])->create(['created_by' => $w['mara']->id]);
    $json = F::doc(F::p(F::mention($w['lene']->id, 'lene'), ' siehe ', F::reference($item->id)));
    $page = Page::factory()->create(['project_id' => $w['web']->id, 'title' => 'Onboarding', 'emoji' => '🚀', 'content' => $json]);
    // the handle changed since the page was saved: the Markdown names the current one, the JSON stays as stored
    $w['lene']->update(['handle' => 'lene2']);

    $data = $shown(GetPage::run(actor($w['lene']), $page));

    expect(array_keys($data))->toBe([
        'id', 'project_id', 'parent_id', 'rank', 'title', 'emoji', 'content', 'content_json', 'version', 'created_by', 'created_at', 'updated_by', 'updated_at',
    ])
        ->and($data['content'])->toBe("@lene2 siehe {$item->key}")
        ->and($data['content_json'])->toBe($json)
        ->and($data['title'])->toBe('Onboarding')
        ->and($data['emoji'])->toBe('🚀')
        ->and($data['version'])->toBe(1)
        ->and($data['project_id'])->toBe($w['web']->id)
        ->and($data['created_by'])->toBe($page->created_by)
        ->and($data['updated_at'])->toBe($page->updated_at?->toJSON());
});

it('answers a page without text with null for both', function () use ($world, $shown) {
    $w = $world();
    $page = Page::factory()->create(['project_id' => $w['web']->id]);

    $data = $shown(GetPage::run(actor($w['mara']), $page));

    expect($data['content'])->toBeNull()->and($data['content_json'])->toBeNull();
});

it('leaves a hidden item reference hidden in the Markdown', function () use ($world, $shown) {
    $w = $world();
    $ops = Project::factory()->identifier('OPS')->private()->member($w['mara'], ProjectRole::Member)->create();
    $secret = WorkItem::factory()->for($ops)->create(['title' => 'Geheim']);
    $page = Page::factory()->create(['project_id' => $w['web']->id, 'content' => F::doc(F::p('Siehe ', F::reference($secret->id)))]);

    expect($shown(GetPage::run(actor($w['lene']), $page))['content'])->toBe("Siehe [hidden](item:{$secret->id})")
        ->and($shown(GetPage::run(actor($w['mara']), $page))['content'])->toBe("Siehe {$secret->key}");
});

it('reads a page by its ULID in any case, anything else is unknown', function () use ($world) {
    $w = $world();
    $page = Page::factory()->create(['project_id' => $w['web']->id]);

    $refusal = function (string $ref) use ($w): ?int {
        try {
            GetPage::run(actor($w['mara']), $ref);
        } catch (Problem $problem) {
            return $problem->getStatusCode();
        }

        return null;
    };

    expect(GetPage::run(actor($w['mara']), strtoupper($page->id))->id)->toBe($page->id)
        ->and(GetPage::run(actor($w['mara']), $page->id)->id)->toBe($page->id)
        ->and($refusal('WEB-1'))->toBe(404)
        ->and($refusal('onboarding'))->toBe(404)
        ->and($refusal('01jc0000000000000000000000'))->toBe(404);
});

it('answers 404 for a page of a private project of someone else and of one being deleted', function () use ($world) {
    $w = $world();
    $ops = Project::factory()->identifier('OPS')->private()->create();
    $hidden = Page::factory()->create(['project_id' => $ops->id]);
    $page = Page::factory()->create(['project_id' => $w['web']->id]);
    $w['web']->update(['deleting_at' => now()]);

    expect(fn () => GetPage::run(actor($w['lene']), $hidden))->toThrow(Problem::class)
        ->and(fn () => GetPage::run(actor($w['mara']), $page->fresh()))->toThrow(Problem::class);
});
