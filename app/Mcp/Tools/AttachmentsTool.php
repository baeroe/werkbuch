<?php

namespace App\Mcp\Tools;

use App\Actions\Attachments\GetAttachment;
use App\Actions\Attachments\ReadAttachmentContent;
use App\Http\Resources\AttachmentResource;
use App\Mcp\Support\McpAction;
use App\Mcp\Support\McpArguments;
use App\Mcp\Support\McpResult;
use App\Mcp\Support\ReadTool;
use App\Mcp\Support\ToolSchema;
use App\Models\Attachment;
use App\Support\Actor;
use App\Support\AttachmentContent;
use App\Support\References;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Tools\Annotations\IsOpenWorld;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

/**
 * `attachments` (spec 4.16): the data of one attachment for whoever sees what names it. The file itself is `url`
 * (outside `/api/v1`), which the same bearer token reads (A235); `content` gives it to an agent as an image or text,
 * without a REST twin (A772). The write is `manage-attachments`; an upload goes through `get-upload-url`.
 */
#[IsReadOnly]
#[IsOpenWorld(false)]
final class AttachmentsTool extends ReadTool
{
    protected string $name = 'attachments';

    protected string $title = 'Attachments';

    protected string $description = 'Reads an attachment (a picture or file of a text, a file of the list of an item). '
        .'`content` gives a picture as an image, a text file as text.';

    protected function actions(): array
    {
        $attachment = ['attachment' => ToolSchema::reference('attachment')];

        return [new McpAction(
            name: 'get',
            summary: 'The data of an attachment.',
            run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new AttachmentResource(GetAttachment::run($actor, References::ulid(Attachment::class, $args->reference('attachment'))))),
            parameters: $attachment,
            required: ['attachment'],
            twin: 'GET attachments/{attachment}',
        ), new McpAction(
            name: 'content',
            summary: 'Its content: a picture as an image, a text as text.',
            run: fn (Actor $actor, McpArguments $args): McpResult => self::content(ReadAttachmentContent::run($actor, References::ulid(Attachment::class, $args->reference('attachment')))),
            parameters: $attachment,
            required: ['attachment'],
        )];
    }

    /** The facts of the attachment as JSON, then the picture or the text (A772). */
    private static function content(AttachmentContent $content): McpResult
    {
        $facts = Response::json($content->facts());

        return match ($content->kind) {
            AttachmentContent::IMAGE => McpResult::content($facts, Response::image($content->data, $content->mime)),
            AttachmentContent::TEXT => McpResult::content($facts, Response::text($content->data)),
            default => McpResult::content($facts),
        };
    }
}
