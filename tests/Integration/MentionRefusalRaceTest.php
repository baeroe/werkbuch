<?php

use App\Access\ProjectRole;
use App\Actions\Agents\StartComment;
use App\Models\Comment;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use App\Support\Actor;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Support\Facades\DB;
use Tests\Support\AgentWorld;
use Tests\Support\RaceConnections;

/*
 * WEBU-36 (A711): notes of the default bot meet. `mariadb` is the first delivery and holds its transaction open with
 * its note written, `mariadb_second` the other one, which gives up waiting for a lock after one second. The mark of a
 * note stands at the row of the asking comment, locked `for update` anyway: a second delivery of the same mention
 * waits for the item, reads the mark under the lock and writes nothing; a note at another item never waits (no locking
 * read of a key that is not there, so no gap lock two notes share).
 */

beforeEach(fn () => RaceConnections::setUp());

afterEach(fn () => RaceConnections::tearDown());

$world = function (): array {
    $mara = User::factory()->admin()->create(['name' => 'Mara']);
    $project = Project::factory()->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $bob = AgentWorld::agent([$project], ['enabled' => false], 'Bob');

    return [$mara, $project, $bob];
};

/** One delivery of the mention of the bot in the comment, every model read on the connection it runs on. */
$deliver = fn (string $itemId, string $botId, string $commentId) => fn () => StartComment::run(
    Actor::system(User::defaultBot(), 'agents'), WorkItem::query()->findOrFail($itemId), User::query()->findOrFail($botId), Comment::query()->findOrFail($commentId),
);

$notes = fn () => Comment::query()->where('author_id', User::defaultBot()->id)->count();

it('finds the mark of a concurrent delivery under the lock and writes no second note', function () use ($world, $deliver, $notes) {
    [$mara, $project, $bob] = $world();
    $item = WorkItem::factory()->for($project)->create(['created_by' => $mara->id]);
    $comment = Comment::factory()->for($item, 'workItem')->create(['author_id' => $mara->id]);

    RaceConnections::hold($deliver($item->id, $bob->id, $comment->id));

    $inserts = 0;
    DB::connection('mariadb_second')->listen(function (QueryExecuted $query) use (&$inserts): void {
        $inserts += str_starts_with($query->sql, 'insert into `comments`') ? 1 : 0;
    });
    RaceConnections::releaseBeforeLock('work_items');
    $outcome = RaceConnections::second($deliver($item->id, $bob->id, $comment->id));

    expect($outcome)->toBeNull()
        ->and($inserts)->toBe(0)
        ->and($notes())->toBe(1)
        ->and(Comment::query()->findOrFail($comment->id)->refusal_noted_at)->not->toBeNull();
});

it('writes notes at two items side by side without waiting', function () use ($world, $deliver, $notes) {
    [$mara, $project, $bob] = $world();
    [$first, $second] = WorkItem::factory()->for($project)->count(2)->create(['created_by' => $mara->id])->all();
    $asked = Comment::factory()->for($first, 'workItem')->create(['author_id' => $mara->id]);
    $other = Comment::factory()->for($second, 'workItem')->create(['author_id' => $mara->id]);

    RaceConnections::hold($deliver($first->id, $bob->id, $asked->id));

    // the first note stays open; the second one, at another item, needs none of its locks
    $outcome = RaceConnections::second($deliver($second->id, $bob->id, $other->id));
    RaceConnections::release();

    expect($outcome)->toBeNull()
        ->and($notes())->toBe(2)
        ->and(Comment::query()->whereKey([$asked->id, $other->id])->whereNotNull('refusal_noted_at')->count())->toBe(2);
});
