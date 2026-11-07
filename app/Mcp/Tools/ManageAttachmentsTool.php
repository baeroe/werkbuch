<?php

namespace App\Mcp\Tools;

use App\Actions\Attachments\DeleteAttachment;
use App\Mcp\Support\McpAction;
use App\Mcp\Support\McpArguments;
use App\Mcp\Support\McpResult;
use App\Mcp\Support\ToolSchema;
use App\Mcp\Support\WriteTool;
use App\Models\Attachment;
use App\Support\Actor;
use App\Support\References;
use Laravel\Mcp\Server\Tools\Annotations\IsDestructive;
use Laravel\Mcp\Server\Tools\Annotations\IsOpenWorld;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

/**
 * `manage-attachments` (spec 4.16), the pair of `attachments`: take a file from the list of an item, or an own upload
 * no text names yet. A picture or file inside a text goes with the text (409 `attachment_inline`). Answers
 * `{done: true}` (REST: 204) and runs at READ COMMITTED (ReadCommitted, the tool opens no transaction around it).
 */
#[IsDestructive]
#[IsReadOnly(false)]
#[IsOpenWorld(false)]
final class ManageAttachmentsTool extends WriteTool
{
    protected string $name = 'manage-attachments';

    protected string $title = 'Manage attachments';

    protected string $description = 'Deletes a file of the list of a work item or an own upload no text names yet; one inside a text goes with the text.';

    protected function actions(): array
    {
        return [new McpAction(
            name: 'delete',
            summary: 'Deletes an attachment.',
            run: function (Actor $actor, McpArguments $args): McpResult {
                DeleteAttachment::run($actor, References::ulid(Attachment::class, $args->reference('attachment')));

                return McpResult::done();
            },
            parameters: ['attachment' => ToolSchema::reference('attachment')],
            required: ['attachment'],
            twin: 'DELETE attachments/{attachment}',
        )];
    }
}
