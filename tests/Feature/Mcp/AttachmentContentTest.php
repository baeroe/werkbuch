<?php

use App\Access\ProjectRole;
use App\Actions\Attachments\ReadAttachmentContent;
use App\Domain\Agents\RunType;
use App\Models\AgentRun;
use App\Models\Attachment;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use Illuminate\Support\Facades\Storage;
use Tests\Support\AgentWorld;
use Tests\Support\Mcp\McpClient;
use Tests\TestCase;

/*
 * `attachments:content` (A772): what an agent sees of a picture or file of an item. A picture comes back as MCP image
 * content (the preview when there is one), a text file as text, anything else as its facts only; whoever may not read
 * it gets the 404 of an unknown one.
 */

beforeEach(function () {
    Storage::fake('local');
    $this->mara = User::factory()->create();
    $this->web = Project::factory()->private()->member($this->mara, ProjectRole::Member)->create();
    $this->item = WorkItem::factory()->for($this->web)->create();
    $this->token = apiToken($this->mara, ['read', 'mcp']);
});

/** A picture made by GD in a format of its own. */
$picture = function (string $format): string {
    $image = imagecreatetruecolor(4, 3);
    ob_start();
    $format === 'gif' ? imagegif($image) : imagepng($image);

    return (string) ob_get_clean();
};

/** The content of an attachment through MCP. */
$content = fn (TestCase $t, string $token, string $id) => McpClient::for($t, $token)->call('attachments', ['action' => 'content', 'attachment' => $id]);

/** The facts of a content (its first part, JSON). */
$facts = fn (array $result) => json_decode($result['content'][0]['text'], true);

it('gives a picture as an image, the preview when there is one', function () use ($picture, $content, $facts) {
    $png = Attachment::factory()->forItem($this->item)->stored($picture('png'), 'image/png', 'shot.png')->create();
    $gif = Attachment::factory()->forItem($this->item)->stored($picture('gif'), 'image/gif', 'anim.gif')->create();

    $shown = $content($this, $this->token, $png->id);
    expect($shown['isError'])->toBeFalse()
        ->and($facts($shown))->toMatchArray(['id' => $png->id, 'filename' => 'shot.png', 'mime' => 'image/png', 'shown' => 'the preview as an image'])
        // the factory stores the file as `.bin`, so medialibrary made the preview a JPEG: the type comes from the bytes
        ->and($shown['content'][1])->toMatchArray(['type' => 'image', 'mimeType' => 'image/jpeg'])
        ->and(base64_decode($shown['content'][1]['data']))->toStartWith("\xFF\xD8");

    // a GIF has no preview (A237): the original
    $original = $content($this, $this->token, strtoupper($gif->id));
    expect($facts($original)['shown'])->toBe('the original as an image')
        ->and($original['content'][1])->toBe(['type' => 'image', 'data' => base64_encode($picture('gif')), 'mimeType' => 'image/gif']);
});

it('refuses a picture over the limit with a sentence', function () use ($content) {
    $big = Attachment::factory()->forItem($this->item)->stored(str_repeat('x', ReadAttachmentContent::IMAGE_MAX + 1), 'image/gif', 'big.gif')->create();

    $refused = $content($this, $this->token, $big->id);
    expect($refused['isError'])->toBeTrue()
        ->and($refused['structuredContent'])->toMatchArray(['status' => 413, 'reason' => 'payload_too_large', 'detail' => 'The picture is larger than 5 MB; look at it in the browser instead.']);
});

it('gives a text file as text, its beginning when it is long', function () use ($content, $facts) {
    $short = Attachment::factory()->forItem($this->item)->stored("server {\n  listen 80;\n}\n", 'text/plain', 'nginx.conf')->create();
    $long = Attachment::factory()->forItem($this->item)->stored(str_repeat('ä', ReadAttachmentContent::TEXT_MAX), 'text/plain', 'long.txt')->create();
    $json = Attachment::factory()->forItem($this->item)->stored('{"a": 1}', 'application/json', 'a.json')->create();

    expect($content($this, $this->token, $short->id)['content'][1])->toBe(['type' => 'text', 'text' => "server {\n  listen 80;\n}\n"])
        ->and($facts($content($this, $this->token, $short->id))['shown'])->toBe('the whole file as text')
        ->and($content($this, $this->token, $json->id)['content'][1]['text'])->toBe('{"a": 1}');

    $cut = $content($this, $this->token, $long->id);
    expect($facts($cut)['shown'])->toBe('the first '.ReadAttachmentContent::TEXT_MAX.' bytes as text')
        ->and($cut['content'][1]['text'])->toBe(str_repeat('ä', ReadAttachmentContent::TEXT_MAX / 2));
});

it('names anything else only by its facts', function () use ($content, $facts) {
    $pdf = Attachment::factory()->forItem($this->item)->stored('%PDF-1.4', 'application/pdf', 'plan.pdf')->create();

    $named = $content($this, $this->token, $pdf->id);
    expect($named['content'])->toHaveCount(1)
        ->and($facts($named))->toMatchArray(['filename' => 'plan.pdf', 'mime' => 'application/pdf', 'size' => 8])
        ->and($facts($named)['shown'])->toStartWith('nothing');
});

it('answers whoever may not read it, and a file that is gone, as an unknown one', function () use ($picture, $content) {
    $png = Attachment::factory()->forItem($this->item)->stored($picture('png'), 'image/png', 'shot.png')->create();
    $outsider = apiToken(User::factory()->create(), ['read', 'mcp']);
    $unknown = $content($this, $outsider, '01kzzzzzzzzzzzzzzzzzzzzzzz');

    expect($content($this, $outsider, $png->id))->toBe($unknown)
        ->and($unknown['structuredContent']['status'])->toBe(404)
        ->and($content($this, $this->token, Attachment::factory()->forItem($this->item)->create()->id)['structuredContent']['status'])->toBe(404);
});

it('lets the token of a run look at the pictures of its item', function () use ($picture, $content) {
    $kira = AgentWorld::agent([$this->web]);
    $png = Attachment::factory()->forItem($this->item)->stored($picture('png'), 'image/png', 'shot.png')->create();
    $run = AgentRun::factory()->type(RunType::Review)->create(['bot_id' => $kira->id, 'project_id' => $this->web->id, 'work_item_id' => $this->item->id]);

    expect($content($this, AgentWorld::token($run), $png->id)['content'][1]['type'])->toBe('image');
});
