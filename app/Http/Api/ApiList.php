<?php

namespace App\Http\Api;

use App\Support\ListResult;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A list answer (P12): Laravel's cursor format `{data, links, meta: {path, per_page, next_cursor, prev_cursor}}` plus
 * `meta.total`, the number of all matches.
 *
 * The links of a `GET` list keep its query (filter, sort, `per_page`), so that following `links.next` gives the next
 * page of the same list. A list read by `POST` (`/work-items/query`) has no address to follow: its `links.next` and
 * `links.prev` are `null`, the same request with `meta.next_cursor` as `cursor` leads on.
 *
 * The cursors of a list with a `ListSpec` carry the signature of its sort (`_sig`, `ListQuery`, `ListResult`). In the
 * document `ApiList::respond($result, X::class)` is `{data: list<X>, links: ListLinks, meta: ListMeta}`
 * (`App\OpenApi\ApiListReturnType`, `ApiListSchema`); the query of the list comes from `#[ListOf]` (`ListParameters`).
 */
final class ApiList
{
    /**
     * @param  ListResult<covariant Model>  $result
     * @param  class-string<JsonResource>  $resource
     */
    public static function respond(ListResult $result, string $resource): JsonResponse
    {
        $get = request()->isMethodSafe();
        if ($get) {
            $result->page->withQueryString();
        }
        $response = $resource::collection($result->page)->additional(['meta' => ['total' => $result->total]])->response();
        if (! $get) {
            // as objects: an empty object (`values: {}`) stays one
            /** @var \stdClass&object{links: \stdClass} $body */
            $body = $response->getData();
            $body->links->next = null;
            $body->links->prev = null;
            $response->setData($body);
        }

        return $response;
    }
}
