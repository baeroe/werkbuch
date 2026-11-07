<?php

namespace App\Mcp\Tools;

use App\Actions\Attachments\IssueUploadUrl;
use App\Mcp\Support\McpAction;
use App\Mcp\Support\McpArguments;
use App\Mcp\Support\McpResult;
use App\Mcp\Support\WriteTool;
use App\OpenApi\ContentSchemas;
use App\Support\Actor;
use Laravel\Mcp\Server\Tools\Annotations\IsDestructive;
use Laravel\Mcp\Server\Tools\Annotations\IsOpenWorld;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

/**
 * `get-upload-url` (spec 6.2): MCP takes no file as an argument; the tool hands out a signed address the agent posts the
 * file to with curl's form (IssueUploadUrl, K11). Its target is the one of `POST /api/v1/attachments` without the file,
 * from the same schema; it has no REST twin.
 */
#[IsDestructive]
#[IsReadOnly(false)]
#[IsOpenWorld(false)]
final class GetUploadUrlTool extends WriteTool
{
    protected string $name = 'get-upload-url';

    protected string $title = 'Get upload URL';

    protected string $description = 'An address to upload a file to; never send file contents as an argument. Post the file with `curl -F file=@<path>` to `url` '
        .'(no bearer token; at most '.IssueUploadUrl::MINUTES.' minutes, after a break again with the same url). It answers the attachment; '
        .'then write `![alt](attachment:<id>)` (picture) or `[name](attachment:<id>)` (file) into a Markdown text. '
        .'`input`: `project_id`, `kind` (`inline` for a text, `file` for the file list of `work_item_id`).';

    protected function actions(): array
    {
        return [new McpAction(
            name: 'call',
            summary: 'An upload address.',
            run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::body(['data' => IssueUploadUrl::run($actor, $args->input())]),
            input: self::target(),
            required: ['input'],
        )];
    }

    /**
     * The target of an upload: the multipart body of `POST /api/v1/attachments` without its file.
     *
     * @return array<string, mixed>
     */
    private static function target(): array
    {
        $schema = ContentSchemas::upload();
        unset($schema['properties']['file']);

        return [
            ...$schema,
            'description' => 'Where the file goes; checked now as the upload checks it, again when the file comes.',
            'required' => ['project_id', 'kind'],
        ];
    }
}
