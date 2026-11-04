<?php

use App\Access\ProjectRole;
use App\Actions\Comments\DeleteComment;
use App\Actions\Pages\DeletePage;
use App\Actions\WorkItems\DeleteWorkItem;
use App\Events\EventType;
use App\Models\Attachment;
use App\Models\Comment;
use App\Models\Event;
use App\Models\Page;
use App\Models\PageVersion;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Spatie\MediaLibrary\MediaCollections\Models\Media;
use Tests\Feature\Access\MatrixWorld;
use Tests\Support\RichTextFixtures as F;

/*
 * The pictures and files of wiki pages (Task 6, A233, A261, A314, K11): a deleted subtree takes its attachments along,
 * their files only after the commit, unless another text of the project still shows one (another page or one of its
 * versions, a description, a comment): then it goes over to that text. Who sees the project sees a page's pictures.
 * WEB with Mara as its admin; its wiki: Start > Ablauf, and Team.
 */

beforeEach(function () {
    Storage::fake('local');
});

$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara']);
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $start = Page::factory()->create(['project_id' => $web->id, 'title' => 'Start', 'created_by' => $mara->id]);
    $flow = Page::factory()->childOf($start)->create(['title' => 'Ablauf']);
    $team = Page::factory()->create(['project_id' => $web->id, 'title' => 'Team', 'created_by' => $mara->id]);

    return compact('mara', 'web', 'start', 'flow', 'team');
};

$png = fn () => (string) base64_decode(explode(',', imageDataUrl())[1]);

/** A stored picture (or file) the page owns. */
$pictureOf = fn (Page $page, string $name) => Attachment::factory()->forPage($page)->stored('Inhalt', 'image/png', $name)
    ->create(['uploaded_by' => $page->created_by]);

$path = fn (Attachment $attachment) => (string) $attachment->getFirstMedia('file')?->getPathRelativeToRoot();

$owner = fn (Attachment $attachment) => Attachment::query()->whereKey($attachment->id)->first(['attachable_type', 'attachable_id', 'kind'])
    ?->only(['attachable_type', 'attachable_id', 'kind']);

it('removes the pictures and files of the subtree after the commit', function () use ($world, $pictureOf, $path) {
    $w = $world();
    $start = $pictureOf($w['start'], 'start.png');
    $plan = $pictureOf($w['start'], 'plan.txt');
    $old = $pictureOf($w['start'], 'alt.png');
    $flow = $pictureOf($w['flow'], 'ablauf.png');
    $kept = $pictureOf($w['team'], 'team.png');
    $w['start']->update(['content' => F::doc(F::image($start->id, 'Start'), F::p(F::file($plan->id, 'plan.txt')))]);
    // pages and versions of the subtree go with it: what only they show keeps nothing (K11)
    $w['flow']->update(['content' => F::doc(F::image($flow->id, null), F::image($start->id, null))]);
    PageVersion::factory()->create(['page_id' => $w['start']->id, 'content' => F::doc(F::image($old->id, 'Alt'))]);
    $paths = array_map($path, [$start, $plan, $old, $flow]);
    $during = null;
    Event::created(function (Event $event) use (&$during, $paths) {
        if ($event->type === EventType::PageDeleted) {
            $during = array_map(fn (string $file) => Storage::disk('local')->exists($file), $paths);
        }
    });

    DeletePage::run(actor($w['mara']), $w['start']);

    expect($during)->toBe([true, true, true, true])
        ->and(array_map(fn (string $file) => Storage::disk('local')->exists($file), $paths))->toBe([false, false, false, false])
        ->and(Attachment::query()->pluck('id')->all())->toBe([$kept->id])
        ->and(Media::query()->pluck('model_id')->all())->toBe([$kept->id])
        ->and(Storage::disk('local')->exists($path($kept)))->toBeTrue();
});

it('hands a picture another page still shows over to that page', function () use ($world, $pictureOf, $path, $owner) {
    $w = $world();
    $start = $pictureOf($w['start'], 'start.png');
    $flow = $pictureOf($w['flow'], 'ablauf.png');
    $gone = $pictureOf($w['start'], 'weg.png');
    // copied into the text of Team (A233), and into one of its versions (A314)
    $w['team']->update(['content' => F::doc(F::p('Siehe'), F::image($start->id, 'Start'))]);
    PageVersion::factory()->create(['page_id' => $w['team']->id, 'content' => F::doc(F::image($flow->id, null))]);
    $files = array_map($path, [$start, $flow, $gone]);

    DeletePage::run(actor($w['mara']), $w['start']);

    expect($owner($start))->toBe(['attachable_type' => 'page', 'attachable_id' => $w['team']->id, 'kind' => 'inline'])
        ->and($owner($flow))->toBe(['attachable_type' => 'page', 'attachable_id' => $w['team']->id, 'kind' => 'inline'])
        ->and($owner($gone))->toBeNull()
        ->and(array_map(fn (string $file) => Storage::disk('local')->exists($file), $files))->toBe([true, true, false])
        ->and(Media::query()->count())->toBe(2);
});

it('hands a picture a description of the project shows over to the item', function () use ($world, $pictureOf, $owner) {
    $w = $world();
    $start = $pictureOf($w['start'], 'start.png');
    $item = WorkItem::factory()->for($w['web'])->create(['description' => F::doc(F::image($start->id, 'Start'))]);
    // the same picture in a text of another project names nothing here
    WorkItem::factory()->create(['description' => F::doc(F::image($pictureOf($w['flow'], 'ablauf.png')->id, null))]);

    DeletePage::run(actor($w['mara']), $w['start']);

    expect($owner($start))->toBe(['attachable_type' => 'work_item', 'attachable_id' => $item->id, 'kind' => 'inline'])
        ->and(Attachment::query()->count())->toBe(1);
    $this->actingAs($w['mara'])->get("/attachments/{$start->id}")->assertOk();
});

/** The MatrixWorld with a picture on a page of WEB (public), one on a page of OPS (private), one of a page that is gone. */
$matrix = function () use ($png): array {
    $w = MatrixWorld::build();
    $picture = fn (Page $page) => Attachment::factory()->forPage($page)->stored($png(), 'image/png', 'karte.png')
        ->create(['uploaded_by' => $w->account('project_admin')->id]);
    $ops = $w->page('outsider_private');
    $leaf = $w->page('project_admin');
    $pictures = ['public' => $picture($w->page('project_admin')), 'private' => $picture($ops), 'gone' => $picture($leaf)];
    $leaf->delete();

    return [$w, $pictures, $ops];
};

it('gives the picture of a page to whoever sees the project and 404 to everyone else', function (string $column) use ($matrix) {
    [$w, $pictures, $ops] = $matrix();
    $sees = ! in_array($column, ['outsider_public', 'outsider_private'], true);
    $this->actingAs($w->account($column));

    // WEB is public: everybody sees it; OPS only its members and the org admins (the default bot is one)
    $this->get("/attachments/{$pictures['public']->id}")->assertOk();
    $this->get("/attachments/{$pictures['private']->id}")->assertStatus($sees ? 200 : 404);
    $this->get("/attachments/{$pictures['gone']->id}")->assertNotFound();
    $owner = $this->getJson("/api/v1/attachments/{$pictures['private']->id}")->assertStatus($sees ? 200 : 404);
    $sees ? $owner->assertJsonPath('data.owner', ['type' => 'page', 'id' => $ops->id]) : $owner->assertJsonMissingPath('detail');
})->with(MatrixWorld::COLUMNS);

it('reads only the project of the page that owns a picture, never its text (N2)', function () use ($world, $pictureOf) {
    $w = $world();
    $picture = $pictureOf($w['start'], 'karte.png');
    $pages = [];
    DB::listen(function (QueryExecuted $query) use (&$pages) {
        if (str_contains($query->sql, '`pages`')) {
            $pages[] = $query->sql;
        }
    });

    $this->actingAs($w['mara'])->get("/attachments/{$picture->id}")->assertOk();

    expect($pages)->toHaveCount(1)
        ->and($pages[0])->toStartWith('select `id`, `project_id` from `pages`');
});

it('hides the picture of a page of a project being deleted, also from an org admin', function () use ($matrix) {
    [$w, $pictures] = $matrix();
    $w->ops->forceFill(['deleting_at' => now()])->save();

    $this->actingAs($w->account('org_admin'))->get("/attachments/{$pictures['private']->id}")->assertNotFound();
});

it('takes over a page\'s picture when an item that showed it is deleted', function () use ($world, $owner) {
    $w = $world();
    $item = WorkItem::factory()->for($w['web'])->create();
    $shown = Attachment::factory()->forItem($item)->create(['uploaded_by' => $w['mara']->id]);
    $versioned = Attachment::factory()->forItem($item)->create(['uploaded_by' => $w['mara']->id]);
    $comment = Comment::factory()->create(['work_item_id' => $item->id, 'author_id' => $w['mara']->id]);
    $commented = Attachment::factory()->create([
        'project_id' => $w['web']->id, 'uploaded_by' => $w['mara']->id, 'attachable_type' => $comment->getMorphClass(), 'attachable_id' => $comment->id,
    ]);
    // the item's picture is copied into a page, another only into a kept version of a page (A314)
    $w['flow']->update(['content' => F::doc(F::image($shown->id, null), F::image($commented->id, null))]);
    PageVersion::factory()->create(['page_id' => $w['team']->id, 'content' => F::doc(F::image($versioned->id, null))]);

    DeleteWorkItem::run(actor($w['mara']), $item);

    expect($owner($shown))->toBe(['attachable_type' => 'page', 'attachable_id' => $w['flow']->id, 'kind' => 'inline'])
        ->and($owner($versioned))->toBe(['attachable_type' => 'page', 'attachable_id' => $w['team']->id, 'kind' => 'inline'])
        ->and($owner($commented))->toBe(['attachable_type' => 'page', 'attachable_id' => $w['flow']->id, 'kind' => 'inline']);
});

it('takes over a comment\'s picture when the comment is deleted', function () use ($world, $owner) {
    $w = $world();
    $item = WorkItem::factory()->for($w['web'])->create();
    $comment = Comment::factory()->create(['work_item_id' => $item->id, 'author_id' => $w['mara']->id]);
    $picture = Attachment::factory()->create([
        'project_id' => $w['web']->id, 'uploaded_by' => $w['mara']->id, 'attachable_type' => $comment->getMorphClass(), 'attachable_id' => $comment->id,
    ]);
    $comment->update(['body' => F::doc(F::image($picture->id, null))]);
    $w['team']->update(['content' => F::doc(F::image($picture->id, null))]);

    DeleteComment::run(actor($w['mara']), $comment);

    expect($owner($picture))->toBe(['attachable_type' => 'page', 'attachable_id' => $w['team']->id, 'kind' => 'inline']);
});
