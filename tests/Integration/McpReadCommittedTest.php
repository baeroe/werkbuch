<?php

use App\Access\ProjectRole;
use App\Models\Attachment;
use App\Models\Comment;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Tests\Support\Mcp\McpClient;
use Tests\Support\RichTextFixtures as F;

/*
 * A deletion over MCP runs at READ COMMITTED (phase 13, task 8b; the note of phase 7 in the rulings, A261, T13-M8):
 * DeleteWorkItem, DeleteComment and DeleteAttachment hand their attachments over inside ReadCommitted::run, which sets
 * the level only at transaction level 0 and passes through inside an open transaction. A tool calls the action without
 * a transaction of its own, so the level is set before the deletion reads the texts, and set back after it. Without
 * the test transaction of RefreshDatabase, as a request has none either.
 */

/**
 * Records every statement of the default connection from now on.
 *
 * @return ArrayObject<int, string>
 */
$statements = function (): ArrayObject {
    /** @var ArrayObject<int, string> $sql */
    $sql = new ArrayObject;
    DB::listen(function (QueryExecuted $query) use ($sql) {
        $sql[] = $query->sql;
    });

    return $sql;
};

/** The position of the first statement that matches, or -1. */
$first = function (ArrayObject $sql, string $pattern): int {
    foreach ($sql as $at => $statement) {
        if (preg_match($pattern, $statement) === 1) {
            return $at;
        }
    }

    return -1;
};

it('deletes an item, a comment and a file at read committed', function () use ($statements, $first) {
    Storage::fake('local');
    $mara = User::factory()->create();
    $web = Project::factory()->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $gone = WorkItem::factory()->for($web)->create(['created_by' => $mara->id]);
    $kept = WorkItem::factory()->for($web)->create(['created_by' => $mara->id]);
    $comment = Comment::factory()->for($kept, 'workItem')->create(['author_id' => $mara->id]);
    $stored = fn (string $name) => Attachment::factory()->stored('Inhalt', 'text/plain', $name)->state(['uploaded_by' => $mara->id]);
    // a picture of the item that goes and one of the comment that goes; the item that stays names both
    $ofItem = $stored('plan.txt')->forItem($gone)->create();
    $ofComment = $stored('skizze.txt')->create(['project_id' => $web->id, 'attachable_type' => $comment->getMorphClass(), 'attachable_id' => $comment->id]);
    $kept->forceFill(['description' => F::doc(F::image($ofItem->id, 'Plan'), F::image($ofComment->id, 'Skizze'))])->save();
    // a file of the list that no text names
    $file = $stored('liste.txt')->forItem($kept, 'file')->create();
    $mcp = McpClient::for($this, apiToken($mara, ['write', 'mcp']));
    $sql = $statements();

    $calls = [
        'comments' => fn () => $mcp->call('manage-comments', ['action' => 'delete', 'comment' => $comment->id]),
        'work_items' => fn () => $mcp->call('manage-work-items', ['action' => 'delete', 'item' => $gone->key]),
        'attachments' => fn () => $mcp->call('manage-attachments', ['attachment' => $file->id]),
    ];

    foreach ($calls as $table => $call) {
        $sql->exchangeArray([]);

        $result = $call();

        $delete = $first($sql, "/^delete from `{$table}` where/");
        $set = $first($sql, '/^set session transaction isolation level read committed$/');
        $lock = $first($sql, '/^select .* from `attachments` .* for update$/');
        $back = $first($sql, '/^set session transaction isolation level repeatable read$/i');
        expect($result['structuredContent'])->toBe(['done' => true], $table)
            // the level is set before the attachments are locked and their texts read, the deletion comes after both,
            // and the level goes back after it
            ->and($set)->toBeGreaterThan(-1, $table)
            ->and($lock)->toBeGreaterThan($set, $table)
            ->and($delete)->toBeGreaterThan($lock, $table)
            ->and($back)->toBeGreaterThan($delete, $table)
            ->and(DB::scalar('select @@session.transaction_isolation'))->toBe('REPEATABLE-READ', $table);
    }

    // both pictures went over to the text that still names them (A261), the file nobody named is gone
    expect(WorkItem::query()->find($gone->id))->toBeNull()
        ->and(Comment::query()->find($comment->id))->toBeNull()
        ->and($ofItem->fresh()?->only(['attachable_type', 'attachable_id', 'kind']))->toBe(['attachable_type' => 'work_item', 'attachable_id' => $kept->id, 'kind' => 'inline'])
        ->and($ofComment->fresh()?->only(['attachable_type', 'attachable_id', 'kind']))->toBe(['attachable_type' => 'work_item', 'attachable_id' => $kept->id, 'kind' => 'inline'])
        ->and(Attachment::query()->find($file->id))->toBeNull();
});
