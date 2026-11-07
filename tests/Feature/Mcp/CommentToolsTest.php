<?php

use App\Access\ProjectRole;
use App\Events\EventType;
use App\Models\Attachment;
use App\Models\Comment;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\Support\Mcp\McpClient;
use Tests\Support\RichTextFixtures as F;

/*
 * The pairs `comments` / `manage-comments` and `attachments` / `manage-attachments` (phase 13, task 8b; K6, K8, K17):
 * comments and files over MCP. That every action answers what its REST twin answers, McpParityTest says (tools.php);
 * this file pins what only MCP meets: a mention in Markdown, a picture that came through `get-upload-url`, and the flow
 * of a member who writes, edits, reacts, reads and removes a file and is refused where REST refuses.
 */

beforeEach(function () {
    Storage::fake('local');
});

/** WEB with Mara and Theo as members (Mara its lead), one item. */
$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara', 'handle' => 'mara']);
    $theo = User::factory()->create(['name' => 'Theo', 'handle' => 'theo']);
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Member)->member($theo, ProjectRole::Member)->create(['lead_id' => $mara->id]);

    return [WorkItem::factory()->for($web)->create(), $mara, $theo];
};

it('writes a comment in markdown and mentions a person', function () use ($world) {
    [$item, $mara, $theo] = $world();
    $plain = apiToken($theo, ['read', 'write', 'mcp']);

    $added = McpClient::for($this, $plain)->call('manage-comments', ['action' => 'add', 'item' => 'web-1', 'input' => ['body' => 'Schau mal, @mara']]);
    $comment = Comment::query()->sole();
    $event = eventsOf(EventType::CommentCreated, $item)->sole();

    expect($added['isError'])->toBeFalse((string) json_encode($added))
        // the text as Markdown, the `_json` form left out (Output::markdown)
        ->and($added['structuredContent']['data']['id'])->toBe($comment->id)
        ->and($added['structuredContent']['data']['body'])->toBe('Schau mal, @mara')
        ->and($added['structuredContent']['data'])->not->toHaveKey('body_json')
        ->and($comment->author_id)->toBe($theo->id)
        // the mention is a node and the event names Mara, as over REST
        ->and(F::mention($mara->id, 'mara'))->toBeIn($comment->body['content'][0]['content'])
        ->and($event->meta['mentioned'])->toBe([$mara->id])
        ->and($event->meta['via'])->toBe('mcp')
        ->and($event->meta['token_id'])->toBe(Str::before($plain, '|'));

    // read back over the read tool: the list of the item, oldest first, and the comment itself
    $listed = McpClient::for($this, $plain)->call('comments', ['action' => 'list', 'item' => 'WEB-1']);
    $got = McpClient::for($this, $plain)->call('comments', ['action' => 'get', 'comment' => strtoupper($comment->id)]);

    expect(array_column($listed['structuredContent']['data'], 'id'))->toBe([$comment->id])
        ->and($listed['structuredContent']['meta']['per_page'])->toBe(25)
        ->and($listed['structuredContent']['meta']['path'])->toBe(url('api/v1/work-items/WEB-1/comments'))
        ->and($got['structuredContent']['data']['body'])->toBe('Schau mal, @mara');
});

it('puts an uploaded image into a comment', function () use ($world) {
    [$item, , $theo] = $world();
    $plain = apiToken($theo, ['read', 'write', 'mcp']);

    $url = McpClient::for($this, $plain)->call('get-upload-url', ['input' => ['project_id' => 'WEB', 'kind' => 'inline']])['structuredContent']['data']['url'];
    forgetApiAuth();
    // a fresh request starts with the default guard `web`; the MCP call before left `sanctum`
    Auth::shouldUse('web');
    $uploaded = $this->post($url, ['file' => UploadedFile::fake()->image('skizze.png')])->assertCreated()->json('data.id');

    // the upload belongs to nobody yet
    expect(Attachment::query()->findOrFail($uploaded)->attachable_id)->toBeNull();

    $added = McpClient::for($this, $plain)->call('manage-comments', ['action' => 'add', 'item' => $item->key, 'input' => ['body' => "![Skizze](attachment:{$uploaded})"]]);
    $comment = Comment::query()->sole();

    expect($added['isError'])->toBeFalse((string) json_encode($added))
        ->and($added['structuredContent']['data']['body'])->toBe("![Skizze](attachment:{$uploaded})")
        // the comment owns the picture now
        ->and(Attachment::query()->findOrFail($uploaded)->only(['attachable_type', 'attachable_id', 'kind']))
        ->toBe(['attachable_type' => 'comment', 'attachable_id' => $comment->id, 'kind' => 'inline']);
});

it('edits and reacts', function () use ($world) {
    [$item, , $theo] = $world();
    $mcp = McpClient::for($this, apiToken($theo, ['read', 'write', 'mcp']));

    $id = $mcp->call('manage-comments', ['action' => 'add', 'item' => $item->key, 'input' => ['body' => 'Erster Wurf']])['structuredContent']['data']['id'];

    $edited = $mcp->call('manage-comments', ['action' => 'edit', 'comment' => $id, 'input' => ['body' => 'Zweiter Wurf']]);
    expect($edited['isError'])->toBeFalse((string) json_encode($edited))
        ->and($edited['structuredContent']['data']['body'])->toBe('Zweiter Wurf')
        ->and($edited['structuredContent']['data']['edited_at'])->toBeString()
        ->and(eventsOf(EventType::CommentUpdated, $item))->toHaveCount(1);

    $reacted = $mcp->call('manage-comments', ['action' => 'react', 'comment' => $id, 'input' => ['emoji' => '👍']]);
    expect($reacted['structuredContent']['data']['reactions'])->toBe([['emoji' => '👍', 'user_ids' => [$theo->id]]]);

    $taken = $mcp->call('manage-comments', ['action' => 'unreact', 'comment' => $id, 'input' => ['emoji' => '👍']]);
    expect($taken['isError'])->toBeFalse((string) json_encode($taken))
        ->and($taken['structuredContent']['data']['reactions'])->toBe([]);

    $deleted = $mcp->call('manage-comments', ['action' => 'delete', 'comment' => $id]);
    expect($deleted['structuredContent'])->toBe(['done' => true])
        ->and(Comment::query()->count())->toBe(0)
        ->and(eventsOf(EventType::CommentDeleted, $item))->toHaveCount(1);
});

it('refuses to edit someone else\'s comment', function () use ($world) {
    [$item, $mara, $theo] = $world();
    $comment = Comment::factory()->for($item, 'workItem')->create(['author_id' => $mara->id, 'body' => F::doc(F::p('Von Mara'))]);

    $refused = McpClient::for($this, apiToken($theo, ['write', 'mcp']))->call('manage-comments', ['action' => 'edit', 'comment' => $comment->id, 'input' => ['body' => 'Von Theo']]);

    expect($refused['isError'])->toBeTrue()
        ->and($refused['structuredContent']['status'])->toBe(403)
        ->and($refused['structuredContent']['detail'])->toBe(__('problem.detail.comment_author_only'))
        ->and($refused['content'][0]['text'])->toBe('403 forbidden: '.__('problem.detail.comment_author_only'))
        // the comment kept Mara's text
        ->and($comment->fresh()?->body)->toBe(F::doc(F::p('Von Mara')))
        ->and(eventsOf(EventType::CommentUpdated, $item))->toHaveCount(0);
});

it('reads and removes a file of the list as a member and is refused for a picture in a text', function () use ($world) {
    [$item, , $theo] = $world();
    $file = Attachment::factory()->stored('Inhalt', 'text/plain', 'plan.txt')->forItem($item, 'file')->create(['uploaded_by' => $theo->id]);
    $picture = Attachment::factory()->stored('Bild', 'text/plain', 'bild.txt')->forItem($item)->create(['uploaded_by' => $theo->id]);
    $plain = apiToken($theo, ['read', 'write', 'mcp']);

    $read = McpClient::for($this, $plain)->call('attachments', ['attachment' => strtoupper($file->id)]);
    expect($read['isError'])->toBeFalse((string) json_encode($read))
        ->and($read['structuredContent']['data']['filename'])->toBe('plan.txt')
        ->and($read['structuredContent']['data']['url'])->toBe("/attachments/{$file->id}");

    // a picture inside a text goes with the text: a 409 as a problem, nothing deleted
    $refused = McpClient::for($this, $plain)->call('manage-attachments', ['attachment' => $picture->id]);
    expect($refused['isError'])->toBeTrue()
        ->and($refused['structuredContent']['status'])->toBe(409)
        ->and($refused['structuredContent']['reason'])->toBe('attachment_inline')
        ->and($refused['content'][0]['text'])->toStartWith('409 attachment_inline: ')
        ->and(Attachment::query()->whereKey($picture->id)->exists())->toBeTrue();

    $removed = McpClient::for($this, $plain)->call('manage-attachments', ['attachment' => $file->id]);
    expect($removed['structuredContent'])->toBe(['done' => true])
        ->and(Attachment::query()->pluck('id')->all())->toBe([$picture->id])
        ->and(eventsOf(EventType::WorkItemUpdated, $item)->sole()->changes['attachments'])->toBe(['old' => ['id' => $file->id, 'filename' => 'plan.txt'], 'new' => null]);
});

it('refuses an unknown comment and attachment with 404', function () use ($world) {
    [, , $theo] = $world();
    $plain = apiToken($theo, ['read', 'write', 'mcp']);

    $comment = McpClient::for($this, $plain)->call('comments', ['action' => 'get', 'comment' => 'not-a-ulid']);
    $attachment = McpClient::for($this, $plain)->call('manage-attachments', ['attachment' => '01jbz7m0000000000000000000']);

    expect([$comment['structuredContent']['status'], $comment['structuredContent']['reason']])->toBe([404, 'not_found'])
        ->and([$attachment['structuredContent']['status'], $attachment['structuredContent']['reason']])->toBe([404, 'not_found']);
});
