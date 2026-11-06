<?php

namespace App\Http\Controllers\Api;

use App\Actions\RichText\ListMentionables;
use App\Actions\RichText\ResolveReferences;
use App\Http\Api\Answer;
use App\Http\Controllers\Controller;
use App\Http\Resources\PageResource;
use App\Http\Resources\UserResource;
use App\Http\Resources\WorkItemResource;
use App\OpenApi\ContentSchemas;
use App\Support\Actor;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/**
 * What the editor of rich text reads: who can be mentioned in a project (`GET /api/v1/mentions?project=…&q=…&limit=…`)
 * and the items and pages behind stored references (`GET /api/v1/references?items=…&pages=…`). What the account may
 * see, the actions decide.
 */
final class RichTextController extends Controller
{
    /**
     * Find accounts to mention.
     *
     * Who can take work in a project: its active members and the org admins, no bot unless it is a member. `{data: User[]}`.
     */
    public function mentions(Request $request): AnonymousResourceCollection
    {
        return UserResource::collection(ListMentionables::run(Actor::fromRequest($request), $request->only(ListMentionables::KEYS)));
    }

    /**
     * Resolve the references of a text.
     *
     * The items and pages the stored references name (a text keeps only the IDs), as far as the account sees them.
     *
     * @return array{data: array{items: AnonymousResourceCollection, pages: AnonymousResourceCollection}} lean items and pages
     */
    #[Answer(200, ContentSchemas::class, 'references', 'Lean items and pages in the order asked for; what the account does not see is left out.')]
    public function references(Request $request): array
    {
        $found = ResolveReferences::run(Actor::fromRequest($request), $request->only(ResolveReferences::KEYS));

        return ['data' => ['items' => WorkItemResource::collection($found['items']), 'pages' => PageResource::collection($found['pages'])]];
    }
}
