<?php

use App\Access\ProjectRole;
use App\Actions\Comments\AddComment;
use App\Actions\Comments\GetComment;
use App\Actions\Comments\ListComments;
use App\Http\Resources\CommentResource;
use App\Models\Comment;
use App\Models\CommentReaction;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Tests\Support\RichTextFixtures as F;

/*
 * Reading the comments of an item (Task 9, P3): whoever sees the item, oldest first, with a cursor; each through
 * CommentResource, which asks the database nothing once Comment::loadForResource() ran (K5).
 */

$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara', 'handle' => 'mara']);
    $web = Project::factory()->identifier('WEB')->public()->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $lene = memberOf($web, ProjectRole::Viewer, ['name' => 'Lene', 'handle' => 'lene']);
    $item = WorkItem::factory()->for($web)->create(['created_by' => $mara->id]);

    return compact('mara', 'web', 'lene', 'item');
};

it('lists the comments oldest first and pages with a cursor', function () use ($world) {
    $w = $world();
    $ids = [];
    foreach (['eins', 'zwei', 'drei'] as $minute => $text) {
        Carbon::setTestNow(Carbon::parse('2026-11-02 09:00:00')->addMinutes($minute));
        $ids[] = AddComment::run(actor($w['mara']), $w['item'], ['body' => $text])->id;
    }
    // two in the same second: the id decides
    $ids[] = AddComment::run(actor($w['lene']), $w['item'], ['body' => 'vier'])->id;
    Comment::factory()->create();

    $first = ListComments::run(actor($w['lene']), $w['item'], ['per_page' => 3]);
    $second = ListComments::run(actor($w['lene']), $w['item'], ['per_page' => 3, 'cursor' => $first->page->nextCursor()?->encode()]);

    expect($first->total)->toBe(4)
        ->and(array_map(fn (Comment $comment) => $comment->id, $first->page->items()))->toBe(array_slice($ids, 0, 3))
        ->and(array_map(fn (Comment $comment) => $comment->id, $second->page->items()))->toBe([$ids[3]]);
});

it('orders comments of one second by their microseconds and pages them without repeating one', function () use ($world) {
    $w = $world();
    // written later in the same second, but earlier in time: the time decides, not the id
    $ids = [];
    foreach (['09:00:05.900000', '09:00:05.100000', '09:00:05.500000', '09:00:05.500000'] as $time) {
        Carbon::setTestNow(Carbon::parse("2026-11-02 {$time}"));
        $ids[] = AddComment::run(actor($w['mara']), $w['item'], ['body' => $time])->id;
    }

    $seen = [];
    $cursor = null;
    do {
        $page = ListComments::run(actor($w['lene']), $w['item'], ['per_page' => 1, ...($cursor ? ['cursor' => $cursor] : [])]);
        $seen = [...$seen, ...array_map(fn (Comment $comment) => $comment->id, $page->page->items())];
        $cursor = $page->page->nextCursor()?->encode();
    } while ($cursor !== null && count($seen) < 10);

    // each once, by the microsecond, the same microsecond by id
    expect($seen)->toBe([$ids[1], $ids[2], $ids[3], $ids[0]])
        ->and(Comment::query()->findOrFail($ids[1])->created_at->format('H:i:s.u'))->toBe('09:00:05.100000');
});

it('takes the item by its key as well', function () use ($world) {
    $w = $world();
    $comment = AddComment::run(actor($w['mara']), $w['item'], ['body' => 'Text.']);

    $page = ListComments::run(actor($w['lene']), strtolower($w['item']->key), []);

    expect(array_map(fn (Comment $comment) => $comment->id, $page->page->items()))->toBe([$comment->id])
        ->and(problemOf(fn () => ListComments::run(actor($w['lene']), 'WEB-999', []))->getStatusCode())->toBe(404);
});

it('answers 404 for an item or comment the account does not see', function () use ($world) {
    $w = $world();
    $ops = Project::factory()->private()->create();
    $comment = Comment::factory()->for(WorkItem::factory()->for($ops), 'workItem')->create();

    expect(problemOf(fn () => ListComments::run(actor($w['lene']), $comment->workItem, []))->getStatusCode())->toBe(404)
        ->and(problemOf(fn () => GetComment::run(actor($w['lene']), $comment))->getStatusCode())->toBe(404);
});

it('shows a comment with its reactions in the order of their first, people by time', function () use ($world) {
    $w = $world();
    $comment = AddComment::run(actor($w['lene']), $w['item'], ['body_json' => F::doc(F::p('Danke, ', F::mention($w['mara']->id, 'mara'), '!'))]);
    $jonas = User::factory()->create();
    $react = function (User $user, string $emoji, string $at) use ($comment): void {
        Carbon::setTestNow(Carbon::parse($at));
        CommentReaction::query()->create(['comment_id' => $comment->id, 'user_id' => $user->id, 'emoji' => $emoji]);
    };
    $react($jonas, '🎉', '2026-11-02 10:00:00');
    $react($w['mara'], '👍', '2026-11-02 10:01:00');
    $react($w['lene'], '🎉', '2026-11-02 10:02:00');
    $react($w['lene'], '👍🏽', '2026-11-02 10:03:00');

    $shown = (new CommentResource(GetComment::run(actor($w['lene']), $comment)))->resolve();

    expect($shown)->toBe([
        'id' => $comment->id,
        'work_item_id' => $w['item']->id,
        'author_id' => $w['lene']->id,
        'body' => 'Danke, @mara!',
        'body_json' => F::doc(F::p('Danke, ', F::mention($w['mara']->id, 'mara'), '!')),
        'created_at' => $comment->created_at?->toJSON(),
        'edited_at' => null,
        'reactions' => [
            ['emoji' => '🎉', 'user_ids' => [$jonas->id, $w['lene']->id]],
            ['emoji' => '👍', 'user_ids' => [$w['mara']->id]],
            ['emoji' => '👍🏽', 'user_ids' => [$w['lene']->id]],
        ],
    ]);
});

it('reads a whole page with a fixed number of queries and leaves the resource nothing to ask', function () use ($world) {
    $w = $world();
    $count = function (int $comments) use ($w): int {
        Comment::query()->delete();
        $other = WorkItem::factory()->for($w['web'])->create();
        foreach (range(1, $comments) as $n) {
            $comment = AddComment::run(actor($w['mara']), $w['item'], ['body_json' => F::doc(F::p(F::mention($w['lene']->id, 'lene'), " {$n} ", F::reference($other->id)))]);
            CommentReaction::query()->create(['comment_id' => $comment->id, 'user_id' => $w['lene']->id, 'emoji' => '👍']);
        }

        // the roles of the reader, as the request reads them before
        ListComments::run(actor($w['lene']), $w['item'], []);
        DB::enableQueryLog();
        DB::flushQueryLog();
        $page = ListComments::run(actor($w['lene']), $w['item'], []);
        $queries = count(DB::getQueryLog());
        $resolved = array_map(fn (Comment $comment) => (new CommentResource($comment))->resolve(), $page->page->items());
        expect(count(DB::getQueryLog()))->toBe($queries)
            ->and($resolved[0]['body'])->toBe("@lene 1 {$other->key}");
        DB::disableQueryLog();

        return $queries;
    };

    expect($count(12))->toBe($count(2));
});
