<?php

namespace App\Mcp\Tools;

use App\Actions\Attachments\GetAttachment;
use App\Http\Resources\AttachmentResource;
use App\Mcp\Support\McpAction;
use App\Mcp\Support\McpArguments;
use App\Mcp\Support\McpResult;
use App\Mcp\Support\ReadTool;
use App\Mcp\Support\ToolSchema;
use App\Models\Attachment;
use App\Support\Actor;
use App\Support\References;
use Laravel\Mcp\Server\Tools\Annotations\IsOpenWorld;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

/**
 * `attachments` (spec 4.16): the data of one attachment for whoever sees what names it. The file itself is `url`
 * (outside `/api/v1`), which the same bearer token reads (A235). The write is `manage-attachments`; an upload goes
 * through `get-upload-url`.
 */
#[IsReadOnly]
#[IsOpenWorld(false)]
final class AttachmentsTool extends ReadTool
{
    protected string $name = 'attachments';

    protected string $title = 'Attachments';

    protected string $description = 'Reads the data of an attachment (a picture or file of a text, a file of the list of an item). '
        .'GET `url` with the same bearer token for the file, `?download=1` to download it.';

    protected function actions(): array
    {
        return [new McpAction(
            name: 'get',
            summary: 'The data of an attachment.',
            run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new AttachmentResource(GetAttachment::run($actor, References::ulid(Attachment::class, $args->reference('attachment'))))),
            parameters: ['attachment' => ToolSchema::reference('attachment')],
            required: ['attachment'],
            twin: 'GET attachments/{attachment}',
        )];
    }
}
