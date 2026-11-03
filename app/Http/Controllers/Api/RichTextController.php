<?php

namespace App\Http\Controllers\Api;

use App\Actions\RichText\ListMentionables;
use App\Actions\RichText\ResolveReferences;
use App\Http\Controllers\Controller;
use App\Http\Resources\UserResource;
use App\Http\Resources\WorkItemResource;
use App\Support\Actor;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/**
 * What the editor of rich text reads: who can be mentioned in a project (`GET /api/v1/mentions?project=…&q=…&limit=…`)
 * and the items behind stored references (`GET /api/v1/references?items=…`). What the account may see, the actions
 * decide.
 */
final class RichTextController extends Controller
{
    /** `{data: UserResource[]}` */
    public function mentions(Request $request): AnonymousResourceCollection
    {
        return UserResource::collection(ListMentionables::run(Actor::fromRequest($request), $request->only(['project', 'q', 'limit'])));
    }

    /** @return array{data: array{items: AnonymousResourceCollection}} lean items */
    public function references(Request $request): array
    {
        return ['data' => ['items' => WorkItemResource::collection(ResolveReferences::run(Actor::fromRequest($request), $request->only(['items'])))]];
    }
}
