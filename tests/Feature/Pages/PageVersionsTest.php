<?php

use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Actions\Pages\GetPageVersion;
use App\Actions\Pages\ListPageVersions;
use App\Actions\Pages\RestorePageVersion;
use App\Events\EventType;
use App\Http\Resources\PageVersionResource;
use App\Models\Attachment;
use App\Models\Page;
use App\Models\PageVersion;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Tests\Support\RichTextFixtures as F;

/*
 * The versions of a page (Task 7, A315, A323): the list without text, newest first, a page at a time; one version with
 * its text for its reader; restoring one as a new version, after the replaced state is kept. WEB (public) with Mara as
 * its admin, Jonas as a member and Lene as a viewer; the page saved last by Jonas as version 3.
 */

$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara', 'handle' => 'mara']);
    $web = Project::factory()->identifier('WEB')->public()->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $jonas = memberOf($web, ProjectRole::Member, ['name' => 'Jonas', 'handle' => 'jonas']);
    $lene = memberOf($web, ProjectRole::Viewer, ['name' => 'Lene', 'handle' => 'lene']);
    $page = Page::factory()->withText('Dritte Fassung')->create([
        'project_id' => $web->id, 'title' => 'Ablauf', 'emoji' => '🚀', 'version' => 3,
        'created_by' => $mara->id, 'updated_by' => $jonas->id, 'updated_at' => now()->subMinute(),
    ]);

    return compact('mara', 'web', 'jonas', 'lene', 'page');
};

$version = fn (Page $page, int $number, array $attributes = []): PageVersion => PageVersion::factory()->create([
    'page_id' => $page->id, 'version' => $number, 'title' => "Ablauf {$number}", 'content' => F::doc(F::p("Fassung {$number}")),
    'author_id' => $page->created_by, 'created_at' => now()->subHours(10 - $number), ...$attributes,
]);

$shown = fn (PageVersion $version): array => (new PageVersionResource($version))->resolve(Request::create('/'));

it('lists the kept versions newest first, without text', function () use ($world, $version, $shown) {
    $w = $world();
    $second = $version($w['page'], 2);
    $first = $version($w['page'], 1);
    $other = Page::factory()->create(['project_id' => $w['web']->id]);
    $version($other, 1);

    $result = ListPageVersions::run(actor($w['lene']), $w['page'], []);
    $items = $result->page->items();

    expect(array_map(fn (PageVersion $v) => $v->id, $items))->toBe([$second->id, $first->id])
        ->and($result->total)->toBe(2)
        ->and(array_key_exists('content', $items[0]->getAttributes()))->toBeFalse()
        ->and($shown($items[0]))->toBe([
            'id' => $second->id, 'page_id' => $w['page']->id, 'version' => 2, 'title' => 'Ablauf 2',
            'author_id' => $w['mara']->id, 'created_at' => $second->created_at?->toJSON(),
        ]);
});

it('shows a version with Markdown for the reader', function () use ($world, $version, $shown) {
    $w = $world();
    $item = WorkItem::factory()->for($w['web'])->create(['created_by' => $w['mara']->id]);
    $secret = WorkItem::factory()->for(Project::factory()->private()->create())->create();
    $json = F::doc(F::p(F::mention($w['lene']->id, 'lene'), ' siehe ', F::reference($item->id), ' und ', F::reference($secret->id)));
    $kept = $version($w['page'], 2, ['content' => $json]);
    // the handle changed since: the Markdown names the current one, the JSON stays as kept
    $w['lene']->update(['handle' => 'lene2']);

    $data = $shown(GetPageVersion::run(actor($w['lene']), $w['page'], $kept));
    $empty = $shown(GetPageVersion::run(actor($w['lene']), $w['page'], $version($w['page'], 1, ['content' => null])));

    expect(array_keys($data))->toBe(['id', 'page_id', 'version', 'title', 'author_id', 'created_at', 'content', 'content_json'])
        ->and($data['content'])->toBe("@lene2 siehe {$item->key} und [hidden](item:{$secret->id})")
        ->and($data['content_json'])->toBe($json)
        ->and($data['version'])->toBe(2)
        ->and([$empty['content'], $empty['content_json']])->toBe([null, null]);
});

it('answers 404 for a version of another page, one gone meanwhile and a page of a private project', function () use ($world, $version) {
    $w = $world();
    $foreign = $version(Page::factory()->create(['project_id' => $w['web']->id]), 1);
    $gone = $version($w['page'], 1);
    $stale = PageVersion::query()->findOrFail($gone->id);
    $gone->delete();
    $private = Page::factory()->create(['project_id' => Project::factory()->private()->create()->id]);

    $read = problemOf(fn () => GetPageVersion::run(actor($w['lene']), $w['page'], $foreign));
    $restored = problemOf(fn () => RestorePageVersion::run(actor($w['mara']), $w['page'], $foreign));
    $meanwhile = problemOf(fn () => RestorePageVersion::run(actor($w['mara']), $w['page'], $stale));
    $listed = problemOf(fn () => ListPageVersions::run(actor($w['lene']), $private, []));

    expect([$read->status, $read->detail])->toBe([404, null])
        ->and([$restored->status, $restored->detail])->toBe([404, null])
        ->and($meanwhile->status)->toBe(404)
        ->and($listed->status)->toBe(404)
        ->and($w['page']->fresh()?->version)->toBe(3)
        ->and(PageVersion::query()->where('page_id', $w['page']->id)->count())->toBe(0)
        ->and(eventsOf(EventType::PageUpdated))->toHaveCount(0);
});

it('restores a version as a new version and keeps the replaced state first', function () use ($world, $version) {
    $w = $world();
    $stored = $w['page']->fresh();
    $first = $version($w['page'], 1, ['title' => 'Ablauf alt', 'content' => F::doc(F::p('Erste **Fassung**'))]);

    $restored = RestorePageVersion::run(actor($w['mara']), $w['page'], $first);

    $kept = PageVersion::query()->where('version', 3)->sole();
    expect([$restored->version, $restored->title, $restored->content, $restored->content_text, $restored->updated_by])
        ->toBe([4, 'Ablauf alt', F::doc(F::p('Erste **Fassung**')), 'Erste **Fassung**', $w['mara']->id])
        ->and($restored->lean)->toBeFalse()
        ->and($restored->rich_names)->not->toBeNull()
        ->and([$kept->page_id, $kept->title, $kept->content, $kept->author_id])->toBe([$w['page']->id, 'Ablauf', $stored?->content, $w['jonas']->id])
        ->and($kept->created_at?->toJSON())->toBe($stored?->updated_at?->toJSON())
        ->and($w['page']->fresh()?->only('version', 'title', 'content_text'))->toBe(['version' => 4, 'title' => 'Ablauf alt', 'content_text' => 'Erste **Fassung**']);

    $event = eventsOf(EventType::PageUpdated, $w['page'])->sole();
    expect($event->changes)->toBe(['title' => ['old' => 'Ablauf', 'new' => 'Ablauf alt'], 'version' => ['old' => 3, 'new' => 4]])
        ->and($event->meta)->toMatchArray(['restored_version' => 1])
        ->and($event->actor_id)->toBe($w['mara']->id)
        ->and($event->project_id)->toBe($w['web']->id)
        ->and(json_encode([$event->changes, $event->meta]))->not->toContain('Fassung');
});

it('keeps the replaced state even for the same writer within the pause, and a number kept already stays', function () use ($world, $version) {
    $w = $world();
    $w['page']->update(['updated_by' => $w['mara']->id]);
    $first = $version($w['page'], 1);
    $kept = $version($w['page'], 3, ['title' => 'Schon gesichert']);

    RestorePageVersion::run(actor($w['mara']), $w['page'], $first);
    $again = RestorePageVersion::run(actor($w['mara']), $w['page'], $first);

    expect(PageVersion::query()->where('page_id', $w['page']->id)->orderBy('version')->pluck('version')->all())->toBe([1, 3, 4])
        ->and($kept->fresh()?->title)->toBe('Schon gesichert')
        ->and(PageVersion::query()->where('version', 4)->sole()->only('title', 'author_id'))->toBe(['title' => 'Ablauf 1', 'author_id' => $w['mara']->id])
        ->and($again->version)->toBe(5)
        ->and(eventsOf(EventType::PageUpdated, $w['page'])->last()?->changes)->toBe(['version' => ['old' => 4, 'new' => 5]]);
});

it('restores title and text but keeps the emoji', function () use ($world, $version) {
    $w = $world();
    $blank = $version($w['page'], 1, ['title' => 'Ablauf', 'content' => null]);

    $restored = RestorePageVersion::run(actor($w['jonas']), $w['page'], $blank);

    expect([$restored->emoji, $restored->title, $restored->content, $restored->content_text])->toBe(['🚀', 'Ablauf', null, null])
        ->and(eventsOf(EventType::PageUpdated, $w['page'])->sole()->changes)->toBe(['version' => ['old' => 3, 'new' => 4]]);
});

it('keeps a reference and a mention of the version the restorer may not see or use', function () use ($world, $version) {
    $w = $world();
    $hidden = WorkItem::factory()->for(Project::factory()->private()->create())->create();
    $kira = memberOf($w['web'], ProjectRole::Member, ['name' => 'Kira', 'handle' => 'kira']);
    $json = F::doc(F::p(F::mention($kira->id, 'kira'), ' siehe ', F::reference($hidden->id)));
    $old = $version($w['page'], 1, ['content' => $json]);
    app(RoleAssignments::class)->removeFromProject($kira, $w['web']);
    $kira->update(['handle' => 'kira2']);

    $restored = RestorePageVersion::run(actor($w['jonas']), $w['page'], $old);

    expect($restored->content)->toBe(F::doc(F::p(F::mention($kira->id, 'kira2'), ' siehe ', F::reference($hidden->id))));
});

it('drops a picture of the version that is gone and keeps one that is still there', function () use ($world, $version) {
    $w = $world();
    $kept = Attachment::factory()->forPage($w['page'])->create(['filename' => 'skizze.png']);
    $gone = Attachment::factory()->forPage($w['page'])->create();
    $old = $version($w['page'], 1, ['content' => F::doc(F::p('Bilder:'), F::image($kept->id, 'Skizze'), F::image($gone->id, 'Alt'))]);
    $gone->delete();

    $restored = RestorePageVersion::run(actor($w['jonas']), $w['page'], $old);

    expect($restored->content)->toBe(F::doc(F::p('Bilder:'), F::image($kept->id, 'Skizze'), ['type' => 'paragraph']))
        ->and($kept->fresh()?->only('attachable_type', 'attachable_id'))->toBe(['attachable_type' => 'page', 'attachable_id' => $w['page']->id]);
});

it('links an upload of the restorer the version names to the page', function () use ($world, $version) {
    $w = $world();
    $upload = Attachment::factory()->create(['project_id' => $w['web']->id, 'uploaded_by' => $w['jonas']->id]);
    $old = $version($w['page'], 1, ['content' => F::doc(F::image($upload->id, 'Skizze'))]);

    RestorePageVersion::run(actor($w['jonas']), $w['page'], $old);

    expect($upload->fresh()?->only('attachable_type', 'attachable_id'))->toBe(['attachable_type' => 'page', 'attachable_id' => $w['page']->id]);
});

it('refuses a viewer to restore, and lets a viewer read the versions', function () use ($world, $version) {
    $w = $world();
    $first = $version($w['page'], 1);

    $listed = ListPageVersions::run(actor($w['lene']), $w['page'], []);
    $read = GetPageVersion::run(actor($w['lene']), $w['page'], $first);
    $refused = problemOf(fn () => RestorePageVersion::run(actor($w['lene']), $w['page'], $first));
    $w['web']->update(['archived_at' => now()]);
    $archived = problemOf(fn () => RestorePageVersion::run(actor($w['mara']), $w['page'], $first));

    expect($listed->total)->toBe(1)
        ->and($read->with_content)->toBeTrue()
        ->and([$refused->status, $refused->detail])->toBe([403, __('problem.detail.wiki_members_only')])
        ->and([$archived->status, $archived->reason])->toBe([409, 'project_archived'])
        ->and($w['page']->fresh()?->version)->toBe(3)
        ->and(eventsOf(EventType::PageUpdated))->toHaveCount(0);
});

it('asks the database as often for 100 versions as for 5', function () use ($world, $version) {
    $w = $world();
    $count = function (int $versions) use ($w, $version): int {
        PageVersion::query()->delete();
        foreach (range(1, $versions) as $n) {
            $version($w['page'], $n, ['author_id' => $n % 2 === 0 ? $w['mara']->id : $w['jonas']->id]);
        }

        // the roles of the reader, as the request reads them before
        ListPageVersions::run(actor($w['lene']), $w['page'], []);
        DB::enableQueryLog();
        DB::flushQueryLog();
        $result = ListPageVersions::run(actor($w['lene']), $w['page'], []);
        $queries = count(DB::getQueryLog());
        DB::disableQueryLog();
        expect($result->page->items())->toHaveCount($versions);

        return $queries;
    };

    expect($count(100))->toBe($count(5));
});
