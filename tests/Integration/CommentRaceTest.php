<?php

use App\Access\ProjectRole;
use App\Actions\Comments\DeleteComment;
use App\Actions\Comments\EditComment;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Comment;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use Tests\Support\RaceConnections;

/*
 * Editing a comment while its author deletes it (Task 9): the deletion holds the item `for update` and has removed the
 * row, the edit waits for the item's lock and then reads the comment afresh: gone, the 404 of an unknown one, never an
 * edit of a row that is no more or a `comment.updated` after the `comment.deleted`. `mariadb` holds the deletion open
 * like a request in progress, `mariadb_second` is the edit and gives up waiting for a lock after one second.
 */

beforeEach(fn () => RaceConnections::setUp());

afterEach(fn () => RaceConnections::tearDown());

it('waits for a concurrent deletion and answers 404', function () {
    $mara = User::factory()->create();
    $web = Project::factory()->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $item = WorkItem::factory()->for($web)->create(['created_by' => $mara->id]);
    $comment = Comment::factory()->for($item, 'workItem')->create(['author_id' => $mara->id]);
    $edit = fn () => EditComment::run(actor($mara), Comment::query()->findOrFail($comment->id), ['body' => 'Doch anders.']);

    RaceConnections::hold(fn () => DeleteComment::run(actor($mara), $comment));

    RaceConnections::expectLockWait(RaceConnections::second($edit), 'work_items');

    RaceConnections::releaseBeforeLock('work_items');
    $outcome = RaceConnections::second($edit);

    expect($outcome)->toBeInstanceOf(Problem::class)
        ->and($outcome instanceof Problem ? $outcome->status : null)->toBe(404)
        ->and(Comment::query()->count())->toBe(0)
        ->and(eventsOf(EventType::CommentDeleted))->toHaveCount(1)
        ->and(eventsOf(EventType::CommentUpdated))->toBeEmpty();
});
