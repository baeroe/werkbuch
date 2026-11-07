<?php

namespace App\Mcp\Tools;

use App\Actions\Comments\AddComment;
use App\Actions\Comments\AddReaction;
use App\Actions\Comments\DeleteComment;
use App\Actions\Comments\EditComment;
use App\Actions\Comments\RemoveReaction;
use App\Http\Resources\CommentResource;
use App\Mcp\Support\McpAction;
use App\Mcp\Support\McpArguments;
use App\Mcp\Support\McpResult;
use App\Mcp\Support\ToolSchema;
use App\Mcp\Support\WriteTool;
use App\Models\Comment;
use App\OpenApi\ContentSchemas;
use App\Support\Actor;
use App\Support\References;
use Laravel\Mcp\Server\Tools\Annotations\IsDestructive;
use Laravel\Mcp\Server\Tools\Annotations\IsOpenWorld;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

/**
 * `manage-comments` (spec 6.2), the pair of `comments`: comment on a work item (Markdown with `@handle`, keys and
 * pictures of `get-upload-url`), edit the own comment, delete one, react and take a reaction back. `delete` answers
 * `{done: true}` (REST: 204) and runs at READ COMMITTED (ReadCommitted, the tool opens no transaction around it).
 */
#[IsDestructive]
#[IsReadOnly(false)]
#[IsOpenWorld(false)]
final class ManageCommentsTool extends WriteTool
{
    protected string $name = 'manage-comments';

    protected string $title = 'Manage comments';

    protected string $description = 'Writes comments of work items. `input.body` is Markdown: `@handle` mentions, `WEB-12` references, '
        .'`![alt](attachment:<id>)` a picture uploaded through `get-upload-url`. Only the author edits a comment.';

    protected function actions(): array
    {
        $comment = ['comment' => ToolSchema::reference('comment')];

        return [
            new McpAction(
                name: 'add',
                summary: 'Comments on an item.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new CommentResource(AddComment::run($actor, References::item($args->reference('item')), $args->input()))),
                parameters: ['item' => ToolSchema::reference('item')],
                input: ContentSchemas::comment(),
                required: ['item', 'input'],
                twin: 'POST work-items/{item}/comments',
            ),
            new McpAction(
                name: 'edit',
                summary: 'Replaces the text of the own comment.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new CommentResource(EditComment::run($actor, self::comment($args), $args->input()))),
                parameters: $comment,
                input: ContentSchemas::comment(),
                required: ['comment', 'input'],
                twin: 'PATCH comments/{comment}',
            ),
            new McpAction(
                name: 'delete',
                summary: 'Deletes a comment (its author or a project admin).',
                run: function (Actor $actor, McpArguments $args): McpResult {
                    DeleteComment::run($actor, self::comment($args));

                    return McpResult::done();
                },
                parameters: $comment,
                required: ['comment'],
                twin: 'DELETE comments/{comment}',
            ),
            new McpAction(
                name: 'react',
                summary: 'Adds the own reaction.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new CommentResource(AddReaction::run($actor, self::comment($args), $args->input()))),
                parameters: $comment,
                input: ContentSchemas::reaction(),
                required: ['comment', 'input'],
                twin: 'PUT comments/{comment}/reactions',
            ),
            new McpAction(
                name: 'unreact',
                summary: 'Takes the own reaction back.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new CommentResource(RemoveReaction::run($actor, self::comment($args), $args->input()))),
                parameters: $comment,
                input: ContentSchemas::unreaction(),
                required: ['comment', 'input'],
                twin: 'DELETE comments/{comment}/reactions',
            ),
        ];
    }

    private static function comment(McpArguments $args): Comment
    {
        return References::ulid(Comment::class, $args->reference('comment'));
    }
}
