<?php

namespace App\Mcp\Tools;

use App\Actions\Comments\GetComment;
use App\Actions\Comments\ListComments;
use App\Http\Resources\CommentResource;
use App\Mcp\Support\McpAction;
use App\Mcp\Support\McpArguments;
use App\Mcp\Support\McpResult;
use App\Mcp\Support\ReadTool;
use App\Mcp\Support\ToolSchema;
use App\Models\Comment;
use App\Support\Actor;
use App\Support\References;
use Laravel\Mcp\Server\Tools\Annotations\IsOpenWorld;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

/**
 * `comments` (spec 6.2): the comments of a work item, oldest first, a page at a time (25 unless the call asks for more,
 * K8), and one comment; the text as Markdown for the account. The writes are `manage-comments`.
 */
#[IsReadOnly]
#[IsOpenWorld(false)]
final class CommentsTool extends ReadTool
{
    protected string $name = 'comments';

    protected string $title = 'Comments';

    protected string $description = 'Reads the comments of a work item, oldest first, with their reactions; the text as Markdown.';

    protected function actions(): array
    {
        $list = ToolSchema::list(ListComments::spec());

        return [
            new McpAction(
                name: 'list',
                summary: 'A page of the comments of an item.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::list(ListComments::run($actor, References::item($args->reference('item')), $args->query(array_keys($list))), CommentResource::class),
                parameters: ['item' => ToolSchema::reference('item'), ...$list],
                required: ['item'],
                twin: 'GET work-items/{item}/comments',
            ),
            new McpAction(
                name: 'get',
                summary: 'One comment.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new CommentResource(GetComment::run($actor, References::ulid(Comment::class, $args->reference('comment'))))),
                parameters: ['comment' => ToolSchema::reference('comment')],
                required: ['comment'],
                twin: 'GET comments/{comment}',
            ),
        ];
    }
}
