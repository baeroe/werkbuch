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
 * WEBU-36 (A711): two deliveries of the same mention meet. The first writes the note of the default bot and holds its
 * transaction open; the second read before (its snapshot is older) and waits for the lock of the item. Under the lock
 * it looks for the note with a locking read and finds it: no second note, no insert that runs into the unique key of
 * `refused_comment_id`. `mariadb` is the first delivery, `mariadb_second` the other one.
 */

beforeEach(fn () => RaceConnections::setUp());

afterEach(fn () => RaceConnections::tearDown());

it('finds the note of a concurrent delivery under the lock and writes none', function () {
    $mara = User::factory()->admin()->create(['name' => 'Mara']);
    $project = Project::factory()->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $item = WorkItem::factory()->for($project)->create(['created_by' => $mara->id]);
    $bob = AgentWorld::agent([$project], ['enabled' => false], 'Bob');
    $comment = Comment::factory()->for($item, 'workItem')->create(['author_id' => $mara->id]);
    $deliver = fn () => StartComment::run(Actor::system(User::defaultBot(), 'agents'), WorkItem::query()->findOrFail($item->id), User::query()->findOrFail($bob->id), Comment::query()->findOrFail($comment->id));

    RaceConnections::hold($deliver);

    $inserts = 0;
    DB::connection('mariadb_second')->listen(function (QueryExecuted $query) use (&$inserts): void {
        $inserts += str_starts_with($query->sql, 'insert into `comments`') ? 1 : 0;
    });
    RaceConnections::releaseBeforeLock('work_items');
    $outcome = RaceConnections::second($deliver);

    expect($outcome)->toBeNull()
        ->and($inserts)->toBe(0)
        ->and(Comment::query()->where('refused_comment_id', $comment->id)->count())->toBe(1);
});
