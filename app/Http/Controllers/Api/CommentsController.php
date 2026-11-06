<?php

namespace App\Http\Controllers\Api;

use App\Actions\Comments\AddComment;
use App\Actions\Comments\AddReaction;
use App\Actions\Comments\DeleteComment;
use App\Actions\Comments\EditComment;
use App\Actions\Comments\GetComment;
use App\Actions\Comments\ListComments;
use App\Actions\Comments\RemoveReaction;
use App\Http\Api\ApiList;
use App\Http\Api\Body;
use App\Http\Api\ListOf;
use App\Http\Controllers\Controller;
use App\Http\Resources\CommentResource;
use App\Models\Comment;
use App\Models\WorkItem;
use App\OpenApi\ContentSchemas;
use App\Support\Actor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * The comments of work items. `{item}` is bound by ULID or key, `{comment}` by ULID (routes/api.php); whether the
 * account sees them and may change them, the actions decide.
 */
final class CommentsController extends Controller
{
    /**
     * List the comments of a work item.
     *
     * A page of comments, oldest first (`cursor`, `per_page`); a former key of the item answers 301 to the current one.
     */
    #[ListOf(ListComments::class)]
    public function index(Request $request, WorkItem $item): JsonResponse
    {
        return ApiList::respond(ListComments::run(Actor::fromRequest($request), $item, $request->query()), CommentResource::class);
    }

    /**
     * Comment on a work item.
     *
     * Everyone who sees the item may comment (also viewers); a person who writes starts to watch it, and so does every
     * person mentioned (bots never watch).
     * 201 `{data: Comment}`. An archived project or item is 409.
     */
    #[Body(ContentSchemas::class, 'comment')]
    public function store(Request $request, WorkItem $item): JsonResponse
    {
        return (new CommentResource(AddComment::run(Actor::fromRequest($request), $item, $request->all())))->response()->setStatusCode(201);
    }

    /**
     * Read a comment.
     *
     * Whoever sees its item.
     */
    public function show(Request $request, Comment $comment): CommentResource
    {
        return new CommentResource(GetComment::run(Actor::fromRequest($request), $comment));
    }

    /**
     * Edit a comment.
     *
     * By its author only. The same text changes nothing (no event, `edited_at` stays).
     */
    #[Body(ContentSchemas::class, 'comment')]
    public function update(Request $request, Comment $comment): CommentResource
    {
        return new CommentResource(EditComment::run(Actor::fromRequest($request), $comment, $request->all()));
    }

    /**
     * Delete a comment.
     *
     * By its author or a project admin; the reactions go with it. 204.
     */
    public function destroy(Request $request, Comment $comment): Response
    {
        DeleteComment::run(Actor::fromRequest($request), $comment);

        return response()->noContent();
    }

    /**
     * React to a comment.
     *
     * 200 `{data: Comment}` with its reactions; the same emoji twice changes nothing.
     * `emoji` may also come as the query `?emoji=`.
     */
    #[Body(ContentSchemas::class, 'reaction')]
    public function react(Request $request, Comment $comment): CommentResource
    {
        return new CommentResource(AddReaction::run(Actor::fromRequest($request), $comment, $request->all()));
    }

    /**
     * Take back a reaction.
     *
     * Only the own one: `emoji` in the body or in the query (the browser sends it there). 200 `{data: Comment}`.
     */
    #[Body(ContentSchemas::class, 'unreaction')]
    public function unreact(Request $request, Comment $comment): CommentResource
    {
        return new CommentResource(RemoveReaction::run(Actor::fromRequest($request), $comment, $request->all()));
    }
}
