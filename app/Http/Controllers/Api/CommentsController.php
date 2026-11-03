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
use App\Http\Controllers\Controller;
use App\Http\Resources\CommentResource;
use App\Models\Comment;
use App\Models\WorkItem;
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
    /** A page of comments, oldest first (`cursor`, `per_page`). */
    public function index(Request $request, WorkItem $item): JsonResponse
    {
        return ApiList::respond(ListComments::run(Actor::fromRequest($request), $item, $request->query()), CommentResource::class);
    }

    /** `body` (Markdown) or `body_json`: 201 `{data: Comment}`. */
    public function store(Request $request, WorkItem $item): CommentResource
    {
        return new CommentResource(AddComment::run(Actor::fromRequest($request), $item, $request->all()));
    }

    public function show(Request $request, Comment $comment): CommentResource
    {
        return new CommentResource(GetComment::run(Actor::fromRequest($request), $comment));
    }

    /** `body` or `body_json`, by its author only. */
    public function update(Request $request, Comment $comment): CommentResource
    {
        return new CommentResource(EditComment::run(Actor::fromRequest($request), $comment, $request->all()));
    }

    /** 204. */
    public function destroy(Request $request, Comment $comment): Response
    {
        DeleteComment::run(Actor::fromRequest($request), $comment);

        return response()->noContent();
    }

    /** `emoji`: 200 `{data: Comment}` with its reactions; the same emoji twice changes nothing. */
    public function react(Request $request, Comment $comment): CommentResource
    {
        return new CommentResource(AddReaction::run(Actor::fromRequest($request), $comment, $request->all()));
    }

    /** `emoji` in the body or the query (the browser): takes back the own one, 200 `{data: Comment}`. */
    public function unreact(Request $request, Comment $comment): CommentResource
    {
        return new CommentResource(RemoveReaction::run(Actor::fromRequest($request), $comment, $request->all()));
    }
}
